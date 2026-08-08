// Loads the six data files once and hands the rest of the app a single bundle.
// Every index is built here, at load, so no interaction ever pays to build one:
// search, the verdict sheet and the browse tiles all read from memory.

import { NUTRIENTS, BROWSABLE_LEVELS } from './nutrients.js';

const DATA_FILES = Object.freeze({
  foods: 'foods.json',
  meals: 'meals.json',
  lexicon: 'lexicon.json',
  sources: 'sources.json',
  cheatsheets: 'cheatsheets.json',
  caffeine: 'caffeine.json',
});

// The eight canonical groups, in the canonical order, per the architecture
// contract. Browse tiles render straight from this order.
export const GROUP_ORDER = Object.freeze([
  'Cheese & dairy',
  'Meat & poultry',
  'Fish & seafood',
  'Eggs',
  'Fruit & veg',
  'Drinks',
  'Pantry & sweets',
  'Takeaway',
]);

// One representative emoji per tile. Emoji is content here, not chrome, and it
// pairs with the group word so the tile never relies on the picture alone.
const GROUP_EMOJI = Object.freeze({
  'Cheese & dairy': '🧀',
  'Meat & poultry': '🍗',
  'Fish & seafood': '🐟',
  'Eggs': '🥚',
  'Fruit & veg': '🥑',
  'Drinks': '☕',
  'Pantry & sweets': '🍪',
  'Takeaway': '🥡',
});

let bundle = null;
let loading = null;
let byId = null;
let byGroup = null;
let byNutrient = null;

// Resolved against this module rather than the page, so the app still finds
// data/ when it is served from a GitHub Pages project subpath.
function dataUrl(file) {
  return new URL(`../../data/${file}`, import.meta.url).href;
}

async function fetchJson(file) {
  let res;
  try {
    res = await fetch(dataUrl(file));
  } catch (cause) {
    throw new Error(`Could not reach data/${file}. The device may be offline.`, { cause });
  }
  if (!res.ok) {
    throw new Error(`data/${file} failed to load (HTTP ${res.status}).`);
  }
  try {
    return await res.json();
  } catch (cause) {
    throw new Error(`data/${file} is not valid JSON.`, { cause });
  }
}

function requireArray(value, file, key) {
  if (!Array.isArray(value)) {
    throw new Error(`data/${file} is missing its "${key}" array.`);
  }
  return value;
}

function optionalArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildIndexes(foods) {
  byId = new Map();
  byGroup = new Map(GROUP_ORDER.map((group) => [group, []]));
  byNutrient = indexNutrients(foods);

  for (const food of foods) {
    if (!food || typeof food.id !== 'string') continue;
    byId.set(food.id, food);
    // An off-contract group is dropped from the tiles rather than inventing a
    // ninth one. The merge script and the validator are what catch it properly.
    const list = byGroup.get(food.group);
    if (list) list.push(food);
  }
}

/**
 * Buckets every food by the nutrients it is a genuine source of.
 *
 * Pure and exported so the test harness can run it straight off the JSON,
 * the same way test-search.js drives the real search module.
 *
 * Two rules are load-bearing:
 *  - only high and med are indexed, because a `low` chip means "people think
 *    this is a source and it is not", so listing it would repeat the myth.
 *  - the order within a level is fixed (safest tier first, then popularity,
 *    then name), so the same list never comes back in a different order.
 */
export function indexNutrients(foods) {
  const index = new Map(NUTRIENTS.map((entry) => [entry.key, { high: [], med: [] }]));

  for (const food of Array.isArray(foods) ? foods : []) {
    if (!food || typeof food.id !== 'string') continue;
    const levels = food.nutrients;
    if (!levels || typeof levels !== 'object') continue;

    for (const { key } of NUTRIENTS) {
      const level = levels[key];
      if (!BROWSABLE_LEVELS.includes(level)) continue;
      index.get(key)[level].push(food);
    }
  }

  for (const buckets of index.values()) {
    for (const level of BROWSABLE_LEVELS) buckets[level].sort(compareForBrowse);
  }
  return index;
}

// Green first, then the honest maybes, then the limits, and the benched ones
// last. A red food still belongs in the list: its craving fix is one tap away,
// and hiding it would quietly narrow the answer she asked for.
const BROWSE_TIER_RANK = Object.freeze({ green: 0, depends: 1, yellow: 2, red: 3 });

function compareForBrowse(a, b) {
  const tier = (BROWSE_TIER_RANK[a.tier] ?? 9) - (BROWSE_TIER_RANK[b.tier] ?? 9);
  if (tier) return tier;
  const popularity = (b.popularity || 0) - (a.popularity || 0);
  if (popularity) return popularity;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

async function build() {
  const [foods, meals, lexicon, sources, cheatsheets, caffeine] = await Promise.all([
    fetchJson(DATA_FILES.foods),
    fetchJson(DATA_FILES.meals),
    fetchJson(DATA_FILES.lexicon),
    fetchJson(DATA_FILES.sources),
    fetchJson(DATA_FILES.cheatsheets),
    fetchJson(DATA_FILES.caffeine),
  ]);

  // foods and sources are load-bearing: a verdict without them is worse than an
  // honest error, so these two throw. The rest degrade to empty.
  const foodList = requireArray(foods && foods.foods, DATA_FILES.foods, 'foods');
  const sourceMap = sources && sources.sources;
  if (!sourceMap || typeof sourceMap !== 'object') {
    throw new Error(`data/${DATA_FILES.sources} is missing its "sources" object.`);
  }

  const next = {
    foods: foodList,
    meals: optionalArray(meals && meals.meals),
    swaps: optionalArray(meals && meals.swaps),
    lexicon: optionalArray(lexicon && lexicon.terms),
    cookedSignals: optionalArray(lexicon && lexicon.cookedSignals),
    sources: sourceMap,
    sheets: optionalArray(cheatsheets && cheatsheets.sheets),
    caffeine: {
      limitMg: Number(caffeine && caffeine.limitMg) || 0,
      drinks: optionalArray(caffeine && caffeine.drinks),
      note: (caffeine && caffeine.note) || '',
    },
  };

  buildIndexes(next.foods);
  bundle = next;
  return bundle;
}

/**
 * Fetches all six data files in parallel and caches the result. Safe to call
 * more than once: concurrent callers share one round of fetches, and a failed
 * load clears itself so a retry can actually retry.
 */
export async function loadData() {
  if (bundle) return bundle;
  if (!loading) {
    loading = build().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

function ensureLoaded() {
  if (!bundle) throw new Error('Data has not loaded yet. Await loadData() first.');
  return bundle;
}

export function getData() {
  return ensureLoaded();
}

export function foodById(id) {
  ensureLoaded();
  return byId.get(String(id)) || null;
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

/**
 * { high: [], med: [] } for one nutrient, ready to render. Always returns the
 * shape, so a caller never has to guard an unknown key.
 */
export function foodsByNutrient(key) {
  ensureLoaded();
  const buckets = byNutrient.get(String(key));
  return buckets ? { high: buckets.high, med: buckets.med } : { high: [], med: [] };
}

/** [{ key, label, count }] for the browse chips, minus any nutrient with nothing behind it. */
export function nutrientCounts() {
  ensureLoaded();
  return NUTRIENTS.map(({ key, label }) => {
    const buckets = byNutrient.get(key) || { high: [], med: [] };
    return { key, label, count: buckets.high.length + buckets.med.length };
  }).filter((entry) => entry.count > 0);
}

/** Short label for a source chip. Falls back to the key so a chip never breaks. */
export function sourceLabel(key) {
  const id = String(key === null || key === undefined ? '' : key);
  if (!bundle) return id;
  const source = bundle.sources[id];
  if (!source) return id;
  return source.label || source.name || id;
}
