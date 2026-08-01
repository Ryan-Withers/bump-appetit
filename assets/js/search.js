// Search is the product. It runs synchronously off in-memory data so a
// keystroke turns into results inside one frame, and it is honest: a weak best
// match is flagged soft so the UI can say "Closest match" instead of pretending.

import Fuse from '../vendor/fuse.basic.min.mjs';
import { normalise, stripFiller } from './util.js';

const FUSE_OPTIONS = {
  keys: [
    { name: 'name', weight: 2 },
    { name: 'aliases', weight: 1.5 },
  ],
  threshold: 0.34,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
};

// Worse than this and the answer is presented as a near miss, not as the answer.
const SOFT_SCORE = 0.5;

let foods = [];
let fuse = null;
let nameIndex = new Map();
let aliasIndex = new Map();
let groupIndex = new Map();

function popularity(food) {
  return Number(food && food.popularity) || 0;
}

function byPopularityThenName(a, b) {
  return popularity(b) - popularity(a) || String(a.name).localeCompare(String(b.name), 'en-AU');
}

function addTo(index, key, food) {
  if (!key) return;
  const list = index.get(key);
  if (list) list.push(food);
  else index.set(key, [food]);
}

/**
 * Indexes the food list once. Fuse only ever sees normalised copies of name and
 * aliases, and the query is folded the same way, so an accent or an apostrophe
 * can never cause a miss. The record keeps an index back to the real food.
 */
export function initSearch(list) {
  foods = Array.isArray(list) ? list.filter(Boolean) : [];
  nameIndex = new Map();
  aliasIndex = new Map();
  groupIndex = new Map();

  const records = foods.map((food, i) => {
    const name = normalise(food.name);
    const aliases = [];
    for (const alias of food.aliases || []) {
      const folded = normalise(alias);
      if (!folded || aliases.includes(folded)) continue;
      aliases.push(folded);
      addTo(aliasIndex, folded, food);
    }
    addTo(nameIndex, name, food);
    addTo(groupIndex, food.group, food);
    return { i, name, aliases };
  });

  for (const group of groupIndex.values()) group.sort(byPopularityThenName);

  fuse = new Fuse(records, FUSE_OPTIONS);
}

function rank(query, cap) {
  const seen = new Set();
  const results = [];

  const push = (food, score, kind) => {
    if (!food || seen.has(food.id)) return;
    seen.add(food.id);
    results.push({ food, score, kind });
  };

  // Exact beats fuzzy, always: name first, then alias.
  for (const food of (nameIndex.get(query) || []).slice().sort(byPopularityThenName)) {
    push(food, 0, 'exact-name');
  }
  for (const food of (aliasIndex.get(query) || []).slice().sort(byPopularityThenName)) {
    push(food, 0, 'exact-alias');
  }

  if (results.length < cap && fuse) {
    // Pull a wider slice than we show, so the popularity tie-break has room to
    // reorder before the list is cut to size.
    const hits = fuse.search(query, { limit: Math.max(cap * 4, 20) });
    const fuzzy = [];
    for (const hit of hits) {
      const food = foods[hit.item.i];
      if (food) fuzzy.push({ food, score: typeof hit.score === 'number' ? hit.score : 1 });
    }
    fuzzy.sort(
      (a, b) =>
        a.score - b.score ||
        popularity(b.food) - popularity(a.food) ||
        String(a.food.name).localeCompare(String(b.food.name), 'en-AU')
    );
    for (const hit of fuzzy) push(hit.food, hit.score, 'fuzzy');
  }

  return results.slice(0, cap);
}

/**
 * Synchronous, no spinner, ever. An empty or whitespace-only query returns
 * nothing rather than everything.
 */
export function search(query, limit = 5) {
  const raw = query === null || query === undefined ? '' : String(query);
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  const plain = normalise(raw);
  const stripped = stripFiller(raw);

  if (!stripped || !fuse) {
    return { query: raw, normalised: stripped, results: [], soft: false };
  }

  let results = rank(stripped, cap);
  // Last resort: a food whose own name carries a filler word is still findable.
  if (!results.length && plain && plain !== stripped) results = rank(plain, cap);

  const soft = results.length > 0 && results[0].score > SOFT_SCORE;
  return { query: raw, normalised: stripped, results, soft };
}

/** Every food in a group, popularity desc then name. Sorted once, at init. */
export function browseGroup(group) {
  const list = groupIndex.get(group);
  return list ? list.slice() : [];
}
