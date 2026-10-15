// Loads the data files once and hands the rest of the app a single bundle.
// Every index is built here, at load, so no interaction ever pays to build one:
// search, the answer sheet, the week tab and the browse tiles all read memory.

const DATA_FILES = Object.freeze({
  entries: 'entries.json',
  weeks: 'weeks.json',
  stages: 'stages.json',
  howtos: 'howtos.json',
  cheatsheets: 'cheatsheets.json',
  sources: 'sources.json',
});

// The eight groups, in the order the browse tiles show them. Sleep and Feeding
// lead because they are what gets typed at 3am; "You two" sits last but is not
// least, it is the one people forget to look after.
export const GROUP_ORDER = Object.freeze([
  'Sleep',
  'Feeding',
  'Crying',
  'Nappies',
  'Skin & body',
  'Illness',
  'Milestones',
  'You two',
]);

const GROUP_EMOJI = Object.freeze({
  'Sleep': '😴',
  'Feeding': '🍼',
  'Crying': '😢',
  'Nappies': '🧷',
  'Skin & body': '🧴',
  'Illness': '🌡️',
  'Milestones': '🌱',
  'You two': '💚',
});

let bundle = null;
let loading = null;
let byId = null;
let byGroup = null;
let howtoById = null;

function dataUrl(file) {
  // Relative so the app works from a project page path as well as a domain root.
  return new URL(`../../data/${file}`, import.meta.url).href;
}

async function fetchJson(file) {
  const res = await fetch(dataUrl(file), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file} answered ${res.status}`);
  return res.json();
}

function requireArray(value, file, key) {
  if (!Array.isArray(value)) throw new Error(`${file} has no ${key} array`);
  return value;
}

function buildIndexes(entries, howtos) {
  byId = new Map();
  byGroup = new Map(GROUP_ORDER.map((group) => [group, []]));
  howtoById = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string') continue;
    byId.set(entry.id, entry);
    // An off-contract group is dropped from the tiles rather than inventing a
    // ninth one. The validator is what catches it properly.
    const list = byGroup.get(entry.group);
    if (list) list.push(entry);
  }

  for (const howto of howtos) {
    if (howto && typeof howto.id === 'string') howtoById.set(howto.id, howto);
  }
}

async function build() {
  const [entries, weeks, stages, howtos, cheatsheets, sources] = await Promise.all([
    fetchJson(DATA_FILES.entries),
    fetchJson(DATA_FILES.weeks),
    fetchJson(DATA_FILES.stages),
    fetchJson(DATA_FILES.howtos),
    fetchJson(DATA_FILES.cheatsheets),
    fetchJson(DATA_FILES.sources),
  ]);

  const sourceMap = sources && sources.sources;
  if (!sourceMap || typeof sourceMap !== 'object') {
    throw new Error('sources.json has no sources object');
  }

  bundle = {
    entries: requireArray(entries && entries.entries, 'entries.json', 'entries'),
    weeks: requireArray(weeks && weeks.weeks, 'weeks.json', 'weeks'),
    stages: requireArray(stages && stages.stages, 'stages.json', 'stages'),
    howtos: requireArray(howtos && howtos.howtos, 'howtos.json', 'howtos'),
    sheets: requireArray(cheatsheets && cheatsheets.sheets, 'cheatsheets.json', 'sheets'),
    sources: sourceMap,
  };

  buildIndexes(bundle.entries, bundle.howtos);
  return bundle;
}

export async function loadData() {
  if (bundle) return bundle;
  if (!loading) {
    loading = build().catch((err) => {
      // A failed load must not poison the next attempt: the retry button on the
      // error screen depends on this being retryable.
      loading = null;
      throw err;
    });
  }
  return loading;
}

function ensureLoaded() {
  if (!bundle) throw new Error('loadData() has not finished yet');
}

export function getData() {
  ensureLoaded();
  return bundle;
}

export function entryById(id) {
  ensureLoaded();
  return byId.get(String(id)) || null;
}

export function howtoById_(id) {
  ensureLoaded();
  return howtoById.get(String(id)) || null;
}

/** [{ group, emoji, count }] in canonical order, for the browse tiles. */
export function groups() {
  ensureLoaded();
  return GROUP_ORDER.map((group) => ({
    group,
    emoji: GROUP_EMOJI[group] || '',
    count: (byGroup.get(group) || []).length,
  }));
}

export function browseGroup(group) {
  ensureLoaded();
  return (byGroup.get(group) || []).slice();
}

/** Short label for a source chip. Falls back to the key so a chip never breaks. */
export function sourceLabel(key) {
  const id = String(key === null || key === undefined ? '' : key);
  if (!bundle) return id;
  const source = bundle.sources[id];
  if (!source) return id;
  return source.label || source.name || id;
}

export function sourceById(key) {
  if (!bundle) return null;
  return bundle.sources[String(key)] || null;
}
