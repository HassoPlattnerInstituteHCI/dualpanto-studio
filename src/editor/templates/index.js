// Template projects are ordinary exported .dualpanto.json files in this folder.
// The dev server exposes a directory listing, which lets users add a template by
// copying an exported project here without maintaining a separate registry.

const directoryUrl = new URL('./', import.meta.url);

async function discoverTemplateFiles() {
  const response = await fetch(directoryUrl);
  if (!response.ok) throw new Error(`Could not load templates (${response.status}).`);
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, 'text/html');
  return [...document.querySelectorAll('a[href]')]
    .map((link) => new URL(link.getAttribute('href'), directoryUrl))
    .filter((url) => url.pathname.endsWith('.dualpanto.json'));
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
