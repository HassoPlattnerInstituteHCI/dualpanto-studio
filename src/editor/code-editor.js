// Code editor: Monaco (the editor of VS Code) from a CDN, with a plain textarea
// as fallback when offline. A local copy in ./vendor/monaco-editor is preferred.

const MONACO_VERSION = '0.52.2';
const SOURCES = [
  './vendor/monaco-editor/min/vs',
  `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`,
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      reject(new Error('load failed: ' + src));
    };
    document.head.appendChild(s);
  });
}

async function loadMonaco() {
  for (const base of SOURCES) {
    try {
      await loadScript(`${base}/loader.js`);
      window.MonacoEnvironment = {
        getWorkerUrl: () => {
          const abs = new URL(base + '/', location.href).href;
          return `data:text/javascript;charset=utf-8,${encodeURIComponent(
            `self.MonacoEnvironment={baseUrl:'${abs.replace(/vs\/$/, '')}'};importScripts('${abs}base/worker/workerMain.js');`
          )}`;
        },
      };
      window.require.config({ paths: { vs: base } });
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 15000);
        window.require(['vs/editor/editor.main'], () => {
          clearTimeout(t);
          resolve(window.monaco);
        }, reject);
      });
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * Multi-file editor: one editor, one document per key ("main" and "level:<id>").
 * onChange(key, value) fires for the document that was edited.
 */
export async function createCodeEditor(container, { onChange = () => {}, typeDefs = '', dark = false } = {}) {
  const monaco = await loadMonaco().catch(() => null);
  if (monaco) return monacoEditor(monaco, container, { onChange, typeDefs, dark });
  return textareaEditor(container, { onChange });
}

function monacoEditor(monaco, container, { onChange, typeDefs, dark }) {
  const js = monaco.languages.typescript.javascriptDefaults;
  js.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ES2020, allowNonTsExtensions: true, checkJs: false, lib: ['es2020', 'dom'] });
  js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [1375, 1378, 1108] });
  js.addExtraLib(typeDefs, 'ts:dualpanto.d.ts');
  const editor = monaco.editor.create(container, {
    theme: dark ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13.5,
    lineHeight: 21,
    tabSize: 2,
    scrollBeyondLastLine: false,
    padding: { top: 10 },
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    renderLineHighlight: 'line',
    fixedOverflowWidgets: true,
  });
  const models = new Map();
  const states = new Map();
  let current = null;
  let silent = false;

  const modelFor = (key, value = '') => {
    let m = models.get(key);
    if (!m) {
      const uri = monaco.Uri.parse('file:///' + key.replace(/[^\w.-]/g, '_') + '.js');
      m = monaco.editor.createModel(value, 'javascript', uri);
      m.onDidChangeContent(() => {
        if (!silent) onChange(key, m.getValue());
        monaco.editor.setModelMarkers(m, 'runtime', []);
      });
      models.set(key, m);
    }
    return m;
  };

  return {
    kind: 'monaco',
    open(key, value = '') {
      const m = modelFor(key, value);
      // Always update the content, even if this document is already open: after a
      // project switch the main script is called "main" again, and previously the
      // old project's text stayed (and was written back by syncScripts, which lost
      // the new script).
      if (value != null && m.getValue() !== value) {
        const pos = key === current ? editor.getPosition() : null;
        silent = true;
        m.setValue(value);
        silent = false;
        if (pos) editor.setPosition(pos);
      }
      if (current === key) return;
      if (current) states.set(current, editor.saveViewState());
      current = key;
      editor.setModel(m);
      const st = states.get(key);
      if (st) editor.restoreViewState(st);
    },
    has: (key) => models.has(key),
    getValue(key) {
      const m = key ? models.get(key) : editor.getModel();
      return m ? m.getValue() : undefined;
    },
    setValue(key, value) {
      silent = true;
      modelFor(key, value).setValue(value);
      silent = false;
    },
    forget(key) {
      models.get(key)?.dispose();
      models.delete(key);
      states.delete(key);
      if (current === key) current = null;
    },
    /** Forget everything – when switching to another project. */
    reset() {
      for (const m of models.values()) m.dispose();
      models.clear();
      states.clear();
      current = null;
    },
    setTheme: (d) => monaco.editor.setTheme(d ? 'vs-dark' : 'vs'),
    markError(key, line, message) {
      const m = models.get(key);
      if (!m || !line || line > m.getLineCount()) return;
      monaco.editor.setModelMarkers(m, 'runtime', [
        { startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: m.getLineMaxColumn(line), message, severity: monaco.MarkerSeverity.Error },
      ]);
    },
    clearErrors() {
      for (const m of models.values()) monaco.editor.setModelMarkers(m, 'runtime', []);
    },
    revealLine(line) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
    layout: () => editor.layout(),
    focus: () => editor.focus(),
  };
}

function textareaEditor(container, { onChange }) {
  container.classList.add('code-fallback');
  const ta = document.createElement('textarea');
  ta.className = 'code-editor';
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Script');
  const values = new Map();
  let current = null;
  ta.addEventListener('input', () => {
    if (!current) return;
    values.set(current, ta.value);
    onChange(current, ta.value);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      ta.setRangeText('  ', s, en, 'end');
      values.set(current, ta.value);
      onChange(current, ta.value);
    }
  });
  container.appendChild(ta);
  const note = document.createElement('div');
  note.className = 'code-note';
  note.textContent = 'Simple editor (Monaco could not be loaded – offline?).';
  container.appendChild(note);
  return {
    kind: 'textarea',
    open(key, value = '') {
      if (current) values.set(current, ta.value);
      current = key;
      if (!values.has(key) || value !== undefined) values.set(key, values.has(key) && value == null ? values.get(key) : value);
      ta.value = values.get(key) ?? '';
    },
    has: (key) => values.has(key),
    getValue(key) {
      if (current) values.set(current, ta.value);
      return key ? values.get(key) : ta.value;
    },
    setValue(key, value) {
      values.set(key, value);
      if (key === current) ta.value = value;
    },
    forget(key) {
      values.delete(key);
    },
    reset() {
      values.clear();
      current = null;
      ta.value = '';
    },
    setTheme: () => {},
    markError: () => {},
    clearErrors: () => {},
    revealLine(line) {
      const lines = ta.value.split('\n');
      const pos = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
    },
    layout: () => {},
    focus: () => ta.focus(),
  };
}
