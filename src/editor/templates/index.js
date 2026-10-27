// Template projects are ordinary exported .dualpanto.json files in this folder.
// templates.json lists them, because static hosts like GitHub Pages have no directory
// listing. The local dev server does have one, so a project copied into this folder shows
// up right away; the console then reminds you to add it to templates.json as well.

const directoryUrl = new URL('./', import.meta.url);
const manifestUrl = new URL('./templates.json', import.meta.url);

async function listedTemplateFiles() {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Could not load templates (${response.status}).`);
  const names = await response.json();
  return names.map((name) => new URL(name, directoryUrl));
}

/** Files in the directory listing (local dev server only; elsewhere this is empty). */
async function discoveredTemplateFiles() {
  try {
    const response = await fetch(directoryUrl);
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) return [];
    const html = await response.text();
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('a[href]')]
      .map((link) => new URL(link.getAttribute('href'), directoryUrl))
      .filter((url) => url.pathname.endsWith('.dualpanto.json'));
  } catch {
    return [];
  }
}

async function discoverTemplateFiles() {
  const [listed, found] = await Promise.all([listedTemplateFiles(), discoveredTemplateFiles()]);
  const known = new Set(listed.map((url) => url.href));
  const extra = found.filter((url) => !known.has(url.href));
  for (const url of extra) {
    console.warn(`Template ${decodeURIComponent(url.pathname.split('/').pop())} is not listed in src/editor/templates/templates.json – it will be missing on GitHub Pages.`);
  }
  return [...listed, ...extra];
}

async function readTemplate(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load template ${url.pathname}.`);
  const project = await response.json();
  if (!project || typeof project.name !== 'string' || typeof project.script !== 'string') return null;

  const key = decodeURIComponent(url.pathname.split('/').pop()).replace(/\.dualpanto\.json$/, '');
  return {
    key,
    title: project.name,
    description: project.description ?? `${project.levels?.length ?? 0} levels`,
    project: () => {
      const { id, version, description, assets, created, updated, ...data } = project;
      return structuredClone(data);
    },
  };
}

const urls = await discoverTemplateFiles();
const loaded = await Promise.all(urls.map(readTemplate));
export const TEMPLATES = loaded.filter(Boolean);

if (!TEMPLATES.length) throw new Error('No .dualpanto.json template projects found.');
