#!/usr/bin/env node
'use strict';

// The quality gate. Ryan edits data/foods.json from his phone, so this script is
// the only thing standing between a typo on a tram and a wrong verdict at 3am.
// Plain Node, zero dependencies, run with: node scripts/validate.js
//
// It fails loudly and specifically: every problem names the file, the id and the
// field, so a fix is obvious without opening a laptop.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TIERS = ['green', 'yellow', 'red', 'depends'];
const VARIANT_TIERS = ['green', 'yellow', 'red'];

// The eight browse tiles. Adding a ninth means touching data.js and the tiles UI,
// so it is deliberately a closed set here.
const GROUPS = [
  'Cheese & dairy',
  'Meat & poultry',
  'Fish & seafood',
  'Eggs',
  'Fruit & veg',
  'Drinks',
  'Pantry & sweets',
  'Takeaway',
];

const MEAL_TYPES = ['snack', 'meal'];

const MEAL_TAGS = [
  'craving-buster',
  'nausea-friendly',
  'iron-boost',
  'calcium',
  'omega-3',
  '5-minute',
  'lunchbox',
  'freezer-friendly',
  'date-night',
  'sweet-treat',
  'comfort',
];

const WHY_MAX = 220;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FLAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// U+2014 em dash plus its lookalikes: horizontal bar, two-em and three-em dash.
// Written as escapes on purpose, so this file passes its own repo-wide sweep.
const EM_DASH = /[\u2014\u2015\u2E3A\u2E3B]/;
const EM_DASH_GLOBAL = /[\u2014\u2015\u2E3A\u2E3B]/g;

// Where the repo-wide em dash sweep looks. Vendored and binary assets are left
// alone: third-party code is not ours to rewrite.
const SCAN_DIRS = ['assets', 'data', 'worker', 'scripts', '.github', 'docs'];
const SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'fonts', 'icons']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.mp3',
]);
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt',
  '.yml', '.yaml', '.toml', '.svg', '.webmanifest',
]);

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

const problems = [];

function fail(file, where, message) {
  problems.push({ file, where, message });
}

function isString(value) {
  return typeof value === 'string';
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFilledStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isFilledString);
}

function readJson(rel) {
  const abs = path.join(ROOT, rel);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch {
    fail(rel, '(file)', 'is missing. Every data file in docs/ARCHITECTURE.md section 2 must exist.');
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(rel, '(file)', `is not valid JSON: ${err.message}`);
    return null;
  }
}

/** One emoji, no more, no less, and it has to actually be an emoji. */
function emojiProblem(value) {
  if (!isFilledString(value)) return 'is missing. Every entry carries exactly one emoji.';
  if (value !== value.trim()) return `has spaces around it: ${JSON.stringify(value)}. Trim it.`;
  const count = Array.from(graphemes.segment(value)).length;
  if (count !== 1) {
    return `must be exactly one emoji, found ${count}: ${JSON.stringify(value)}`;
  }
  if (!/\p{Extended_Pictographic}/u.test(value)) {
    return `is not an emoji: ${JSON.stringify(value)}`;
  }
  return null;
}

/**
 * Walks every key and every string in a parsed JSON tree looking for em dashes.
 * Doing it on the parsed tree rather than the raw text means the error can name
 * the exact path, for example foods[41].why, instead of a line number.
 */
function scanJsonForEmDashes(rel, node, trail) {
  if (isString(node)) {
    if (EM_DASH.test(node)) {
      fail(rel, trail, `contains an em dash. Use a hyphen or rewrite: ${JSON.stringify(node.slice(0, 90))}`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      // Prefer the entry id over the array index: "foods[brie].why" is something
      // you can find on a phone, "foods[41].why" is not.
      const isEntry = item && typeof item === 'object' && !Array.isArray(item);
      const key = isEntry && isFilledString(item.id) ? item.id : String(i);
      scanJsonForEmDashes(rel, item, `${trail}[${key}]`);
    });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (EM_DASH.test(key)) {
        fail(rel, trail || '(root)', `has a key containing an em dash: ${JSON.stringify(key)}`);
      }
      scanJsonForEmDashes(rel, value, trail ? `${trail}.${key}` : key);
    }
  }
}

function walkFiles(dirAbs, out) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      walkFiles(abs, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXT.has(ext)) continue;
      if (!TEXT_EXT.has(ext)) continue;
      out.push(abs);
    }
  }
  return out;
}

/**
 * The no-em-dash rule is project-wide, not a data rule, so the sweep covers the
 * source too. Data JSON is skipped here because scanJsonForEmDashes already gave
 * those a better error with the food id in it.
 */
function scanRepoForEmDashes() {
  const files = [];

  for (const dir of SCAN_DIRS) {
    walkFiles(path.join(ROOT, dir), files);
  }

  for (const name of fs.readdirSync(ROOT)) {
    const abs = path.join(ROOT, name);
    if (!fs.statSync(abs).isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (BINARY_EXT.has(ext) || !TEXT_EXT.has(ext)) continue;
    files.push(abs);
  }

  let scanned = 0;
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel.startsWith('data/') && rel.endsWith('.json')) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    if (!EM_DASH.test(text)) continue;
    text.split('\n').forEach((line, i) => {
      EM_DASH_GLOBAL.lastIndex = 0;
      const hit = EM_DASH_GLOBAL.exec(line);
      if (!hit) return;
      fail(rel, `line ${i + 1}, col ${hit.index + 1}`, `em dash found. Use a hyphen or rewrite: ${line.trim().slice(0, 90)}`);
    });
  }

  return { files: files.length, scanned };
}

function checkSources(sources) {
  const keys = new Set();
  if (!sources || typeof sources.sources !== 'object' || sources.sources === null) {
    fail('data/sources.json', '(root)', 'must be an object with a "sources" key.');
    return keys;
  }
  for (const [key, entry] of Object.entries(sources.sources)) {
    keys.add(key);
    const where = `sources.${key}`;
    if (!ID_RE.test(key)) fail('data/sources.json', where, 'key must be kebab-case, for example "rwh-2026".');
    if (!entry || typeof entry !== 'object') {
      fail('data/sources.json', where, 'must be an object with label, name, url and approved.');
      continue;
    }
    for (const field of ['label', 'name', 'url']) {
      if (!isFilledString(entry[field])) fail('data/sources.json', `${where}.${field}`, 'is missing or empty.');
    }
    if (!isFilledString(entry.url) || !/^https:\/\//.test(entry.url)) {
      fail('data/sources.json', `${where}.url`, 'must be an https URL.');
    }
    if (!DAY_RE.test(String(entry.approved))) {
      fail('data/sources.json', `${where}.approved`, `must be YYYY-MM-DD, found ${JSON.stringify(entry.approved)}.`);
    }
  }
  if (keys.size === 0) fail('data/sources.json', 'sources', 'is empty. Every food needs at least one source to point at.');
  return keys;
}

function checkFoods(bundle, sourceKeys) {
  const file = 'data/foods.json';
  const stats = {
    count: 0,
    tiers: { green: 0, yellow: 0, red: 0, depends: 0 },
    variants: 0,
    aliases: 0,
    groups: new Map(),
    flagged: 0,
    splits: 0,
    sourcesUsed: new Set(),
  };

  if (!bundle || !Array.isArray(bundle.foods)) {
    fail(file, '(root)', 'must be an object with a "foods" array.');
    return stats;
  }
  if (bundle.schema !== 2) {
    fail(file, 'schema', `must be 2, found ${JSON.stringify(bundle.schema)}. See docs/ARCHITECTURE.md section 2.`);
  }

  const foods = bundle.foods;
  const ids = new Map();
  const namesById = new Map();
  const aliasOwner = new Map();

  // Names first, so the alias sweep below can tell an alias apart from another
  // food's name in a single pass.
  foods.forEach((food, i) => {
    if (!food || typeof food !== 'object') return;
    if (isFilledString(food.name)) namesById.set(food.name.trim().toLowerCase(), food.id || `foods[${i}]`);
  });

  foods.forEach((food, i) => {
    const label = food && isFilledString(food.id) ? food.id : `foods[${i}]`;
    const at = (field) => `${label}.${field}`;

    if (!food || typeof food !== 'object' || Array.isArray(food)) {
      fail(file, `foods[${i}]`, 'must be an object.');
      return;
    }

    stats.count += 1;

    // 1. Required fields.
    if (!isFilledString(food.id)) {
      fail(file, `foods[${i}].id`, 'is missing. Every food needs a stable kebab-case id.');
    } else if (!ID_RE.test(food.id)) {
      fail(file, at('id'), `must be kebab-case, found ${JSON.stringify(food.id)}.`);
    } else if (ids.has(food.id)) {
      fail(file, `foods[${i}].id`, `is ${JSON.stringify(food.id)}, already used by foods[${ids.get(food.id)}]. Ids are localStorage keys for favourites, so they must be unique and stable.`);
    } else {
      ids.set(food.id, i);
    }

    if (!isFilledString(food.name)) fail(file, at('name'), 'is missing.');
    if (!isFilledString(food.why)) fail(file, at('why'), 'is missing. Every verdict needs a reason.');

    const emojiIssue = emojiProblem(food.emoji);
    if (emojiIssue) fail(file, at('emoji'), emojiIssue);

    // 6. why fits the sheet without scrolling.
    if (isString(food.why) && food.why.length > WHY_MAX) {
      fail(file, at('why'), `is ${food.why.length} characters, over the ${WHY_MAX} limit. Trim it so the sheet does not scroll.`);
    }

    if (!GROUPS.includes(food.group)) {
      fail(file, at('group'), `is ${JSON.stringify(food.group)}, which is not one of the eight browse groups: ${GROUPS.join(', ')}.`);
    } else {
      stats.groups.set(food.group, (stats.groups.get(food.group) || 0) + 1);
    }

    if (!TIERS.includes(food.tier)) {
      fail(file, at('tier'), `is ${JSON.stringify(food.tier)}. Use one of: ${TIERS.join(', ')}.`);
    } else {
      stats.tiers[food.tier] += 1;
    }

    if (!Number.isInteger(food.popularity) || food.popularity < 1 || food.popularity > 3) {
      fail(file, at('popularity'), `must be an integer 1 to 3, found ${JSON.stringify(food.popularity)}.`);
    }

    // makeItGreen and swap must be present as keys, even when the answer is null.
    for (const field of ['makeItGreen', 'swap']) {
      if (!(field in food)) {
        fail(file, at(field), 'key is missing. Use null when there is not one.');
      } else if (food[field] !== null && !isFilledString(food[field])) {
        fail(file, at(field), 'must be a non-empty string or null.');
      }
    }

    if (!Array.isArray(food.flags)) {
      fail(file, at('flags'), 'must be an array. Use [] when nothing is pending.');
    } else {
      for (const flag of food.flags) {
        if (!isFilledString(flag) || !FLAG_RE.test(flag)) {
          fail(file, at('flags'), `contains ${JSON.stringify(flag)}. Flags are lowercase kebab-case, for example "confirm".`);
        }
      }
      if (food.flags.length > 0) stats.flagged += 1;
    }

    // 4. Sources and review date.
    if (!isFilledStringArray(food.sources)) {
      fail(file, at('sources'), 'needs at least one source key from data/sources.json. Nothing ships unsourced.');
    } else {
      for (const key of food.sources) {
        if (!sourceKeys.has(key)) {
          fail(file, at('sources'), `refers to ${JSON.stringify(key)}, which is not in data/sources.json. Known keys: ${[...sourceKeys].join(', ')}.`);
        } else {
          stats.sourcesUsed.add(key);
        }
      }
    }
    if (!MONTH_RE.test(String(food.reviewed))) {
      fail(file, at('reviewed'), `must be YYYY-MM, found ${JSON.stringify(food.reviewed)}.`);
    }

    // 2. Aliases: lowercase, 3 characters minimum, and each one maps to exactly
    // one food. An ambiguous alias is a wrong verdict waiting to happen.
    if (!isFilledStringArray(food.aliases)) {
      fail(file, at('aliases'), 'must be a non-empty array of lowercase search terms.');
    } else {
      const seenHere = new Set();
      food.aliases.forEach((alias, j) => {
        const spot = `${label}.aliases[${j}]`;
        if (alias !== alias.trim()) {
          fail(file, spot, `has spaces around it: ${JSON.stringify(alias)}.`);
          return;
        }
        if (alias !== alias.toLowerCase()) {
          fail(file, spot, `must be lowercase, found ${JSON.stringify(alias)}.`);
          return;
        }
        if (alias.length < 3) {
          fail(file, spot, `is ${JSON.stringify(alias)}, shorter than 3 characters. Short aliases match everything.`);
          return;
        }
        if (seenHere.has(alias)) {
          fail(file, spot, `is listed twice on this entry: ${JSON.stringify(alias)}.`);
          return;
        }
        seenHere.add(alias);
        if (aliasOwner.has(alias)) {
          fail(file, spot, `${JSON.stringify(alias)} is already an alias of "${aliasOwner.get(alias)}". An alias must map to exactly one food.`);
          return;
        }
        aliasOwner.set(alias, label);
        stats.aliases += 1;

        const nameOwner = namesById.get(alias);
        if (nameOwner && nameOwner !== food.id) {
          fail(file, spot, `${JSON.stringify(alias)} is the name of "${nameOwner}". An alias may not shadow another food's name.`);
        }
      });
    }

    // 1 and 3. Variants, and the kindness rule.
    const isDepends = food.tier === 'depends';
    if (isDepends) {
      if (!Array.isArray(food.variants) || food.variants.length < 2) {
        fail(file, at('variants'), `is a "depends" food, so it needs at least 2 variants, found ${Array.isArray(food.variants) ? food.variants.length : 0}.`);
      }
    } else if (food.variants !== undefined) {
      fail(file, at('variants'), `is only for "depends" foods. This entry is "${food.tier}".`);
    }

    if (Array.isArray(food.variants)) {
      food.variants.forEach((variant, j) => {
        const spot = `${label}.variants[${j}]`;
        stats.variants += 1;
        if (!variant || typeof variant !== 'object') {
          fail(file, spot, 'must be an object with label, tier and why.');
          return;
        }
        if (!isFilledString(variant.label)) fail(file, `${spot}.label`, 'is missing.');
        if (!isFilledString(variant.why)) fail(file, `${spot}.why`, 'is missing.');
        if (isString(variant.why) && variant.why.length > WHY_MAX) {
          fail(file, `${spot}.why`, `is ${variant.why.length} characters, over the ${WHY_MAX} limit.`);
        }
        if (!VARIANT_TIERS.includes(variant.tier)) {
          fail(file, `${spot}.tier`, `is ${JSON.stringify(variant.tier)}. A variant resolves the question, so it must be one of: ${VARIANT_TIERS.join(', ')}.`);
        }
        if (variant.tier === 'red' && !isFilledString(variant.makeItGreen) && !isFilledString(variant.swap)) {
          fail(file, spot, `is red with no way out. Add a "makeItGreen" or a "swap" to ${JSON.stringify(variant.label)}. No dead ends: that rule is a build check, not a guideline.`);
        }
      });
    }

    if (food.tier === 'red' && !isFilledString(food.makeItGreen) && !isFilledString(food.swap)) {
      fail(file, label, 'is red with no way out. Add a "makeItGreen" or a "swap". No dead ends: that rule is a build check, not a guideline.');
    }

    // 7. Split verdicts: the honest 50-50s, where the sources genuinely
    // disagree or simply do not cover it. Optional on any entry. Each position
    // is shown to her verbatim with its attribution, so the same rules apply
    // as to why: short, kind, and never a wall of text.
    if (food.split !== undefined) {
      const spot = at('split');
      if (!food.split || typeof food.split !== 'object' || Array.isArray(food.split)) {
        fail(file, spot, 'must be an object with a note and at least two positions.');
      } else {
        stats.splits += 1;
        if (!isFilledString(food.split.note)) {
          fail(file, `${spot}.note`, 'is missing. Say plainly that this one is a judgement call.');
        } else if (food.split.note.length > WHY_MAX) {
          fail(file, `${spot}.note`, `is ${food.split.note.length} characters, over the ${WHY_MAX} limit.`);
        }
        if (!Array.isArray(food.split.positions) || food.split.positions.length < 2) {
          fail(file, `${spot}.positions`, 'needs at least two positions. One opinion is not a split.');
        } else {
          food.split.positions.forEach((pos, j) => {
            const posSpot = `${spot}.positions[${j}]`;
            if (!pos || typeof pos !== 'object') {
              fail(file, posSpot, 'must be an object with label and says.');
              return;
            }
            if (!isFilledString(pos.label)) fail(file, `${posSpot}.label`, 'is missing. Who says this?');
            if (!isFilledString(pos.says)) fail(file, `${posSpot}.says`, 'is missing.');
            if (isString(pos.says) && pos.says.length > WHY_MAX) {
              fail(file, `${posSpot}.says`, `is ${pos.says.length} characters, over the ${WHY_MAX} limit.`);
            }
            if (pos.source !== undefined) {
              if (!sourceKeys.has(pos.source)) {
                fail(file, `${posSpot}.source`, `refers to ${JSON.stringify(pos.source)}, which is not in data/sources.json.`);
              } else {
                stats.sourcesUsed.add(pos.source);
              }
            }
          });
        }
      }
    }
  });

  return stats;
}

function checkMeals(bundle) {
  const file = 'data/meals.json';
  const stats = { meals: 0, snacks: 0, mains: 0, swaps: 0 };

  if (!bundle || !Array.isArray(bundle.meals)) {
    fail(file, '(root)', 'must be an object with a "meals" array.');
    return stats;
  }

  const ids = new Set();
  bundle.meals.forEach((meal, i) => {
    const label = meal && isFilledString(meal.id) ? meal.id : `meals[${i}]`;
    const at = (field) => `${label}.${field}`;
    if (!meal || typeof meal !== 'object') {
      fail(file, `meals[${i}]`, 'must be an object.');
      return;
    }
    stats.meals += 1;

    if (!isFilledString(meal.id)) fail(file, `meals[${i}].id`, 'is missing.');
    else if (!ID_RE.test(meal.id)) fail(file, at('id'), `must be kebab-case, found ${JSON.stringify(meal.id)}.`);
    else if (ids.has(meal.id)) fail(file, at('id'), 'is a duplicate.');
    else ids.add(meal.id);

    if (!isFilledString(meal.name)) fail(file, at('name'), 'is missing.');
    if (!isFilledString(meal.punLine)) fail(file, at('punLine'), 'is missing. The pun is the point of this screen.');

    // The pun is the personality, the dish line is the information. A card has
    // to say what the food IS without being tapped, so this is required and
    // short enough to never wrap twice.
    if (!isFilledString(meal.dish)) {
      fail(file, at('dish'), 'is missing. One plain line saying what the recipe actually is, e.g. "Ham and cheese toastie".');
    } else if (meal.dish.length > 60) {
      fail(file, at('dish'), `is ${meal.dish.length} characters, over the 60 limit. It has to read at a glance.`);
    }

    const emojiIssue = emojiProblem(meal.emoji);
    if (emojiIssue) fail(file, at('emoji'), emojiIssue);

    if (!MEAL_TYPES.includes(meal.type)) {
      fail(file, at('type'), `is ${JSON.stringify(meal.type)}. Use "snack" or "meal".`);
    } else if (meal.type === 'snack') {
      stats.snacks += 1;
    } else {
      stats.mains += 1;
    }

    if (!isFilledStringArray(meal.tags)) {
      fail(file, at('tags'), 'needs at least one tag.');
    } else {
      for (const tag of meal.tags) {
        if (!MEAL_TAGS.includes(tag)) {
          fail(file, at('tags'), `has ${JSON.stringify(tag)}, which is not in the closed tag set: ${MEAL_TAGS.join(', ')}.`);
        }
      }
    }

    if (!isFilledStringArray(meal.ingredients)) fail(file, at('ingredients'), 'needs at least one ingredient.');
    if (!isFilledStringArray(meal.steps)) fail(file, at('steps'), 'needs at least one step.');
    if (!MONTH_RE.test(String(meal.reviewed))) {
      fail(file, at('reviewed'), `must be YYYY-MM, found ${JSON.stringify(meal.reviewed)}.`);
    }
  });

  if (!Array.isArray(bundle.swaps)) {
    fail(file, 'swaps', 'must be an array of craving swaps.');
  } else {
    bundle.swaps.forEach((swap, i) => {
      stats.swaps += 1;
      if (!swap || typeof swap !== 'object') {
        fail(file, `swaps[${i}]`, 'must be an object with craving and swap.');
        return;
      }
      if (!isFilledString(swap.craving)) fail(file, `swaps[${i}].craving`, 'is missing.');
      if (!isFilledString(swap.swap)) fail(file, `swaps[${i}].swap`, 'is missing. A craving with no answer is a dead end.');
    });
  }

  return stats;
}

function checkLexicon(bundle) {
  const file = 'data/lexicon.json';
  const stats = { terms: 0, phrases: 0, signals: 0 };

  if (!bundle || !Array.isArray(bundle.terms)) {
    fail(file, '(root)', 'must be an object with a "terms" array.');
    return stats;
  }

  const owner = new Map();
  bundle.terms.forEach((term, i) => {
    const label = term && Array.isArray(term.match) && isFilledString(term.match[0]) ? term.match[0] : `terms[${i}]`;
    stats.terms += 1;
    if (!term || typeof term !== 'object') {
      fail(file, `terms[${i}]`, 'must be an object with match, tier and why.');
      return;
    }
    if (!VARIANT_TIERS.includes(term.tier)) {
      fail(file, `${label}.tier`, `is ${JSON.stringify(term.tier)}. A menu line resolves to one of: ${VARIANT_TIERS.join(', ')}.`);
    }
    if (!isFilledString(term.why)) fail(file, `${label}.why`, 'is missing. The scanner shows this line by line.');
    if (term.tier === 'red' && !isFilledString(term.makeItGreen) && !isFilledString(term.swap)) {
      fail(file, label, 'is a red lexicon term with no way out. Add a "makeItGreen" so the scan result stays kind.');
    }
    if (!isFilledStringArray(term.match)) {
      fail(file, `${label}.match`, 'needs at least one lowercase phrase to match on.');
      return;
    }
    for (const phrase of term.match) {
      stats.phrases += 1;
      if (phrase !== phrase.toLowerCase() || phrase !== phrase.trim()) {
        fail(file, `${label}.match`, `${JSON.stringify(phrase)} must be lowercase and trimmed. Matching runs on normalised text.`);
      }
      if (owner.has(phrase)) {
        fail(file, `${label}.match`, `${JSON.stringify(phrase)} is already matched by "${owner.get(phrase)}". A phrase may only belong to one term.`);
      } else {
        owner.set(phrase, label);
      }
    }
  });

  if (!isFilledStringArray(bundle.cookedSignals)) {
    fail(file, 'cookedSignals', 'must be a non-empty array of lowercase words.');
  } else {
    stats.signals = bundle.cookedSignals.length;
    for (const signal of bundle.cookedSignals) {
      if (signal !== signal.toLowerCase() || signal !== signal.trim()) {
        fail(file, 'cookedSignals', `${JSON.stringify(signal)} must be lowercase and trimmed.`);
      }
    }
  }

  return stats;
}

function checkCheatsheets(bundle) {
  const file = 'data/cheatsheets.json';
  const stats = { sheets: 0, rows: 0, asks: 0 };

  if (!bundle || !Array.isArray(bundle.sheets)) {
    fail(file, '(root)', 'must be an object with a "sheets" array.');
    return stats;
  }

  const ids = new Set();
  bundle.sheets.forEach((sheet, i) => {
    const label = sheet && isFilledString(sheet.id) ? sheet.id : `sheets[${i}]`;
    const at = (field) => `${label}.${field}`;
    stats.sheets += 1;
    if (!sheet || typeof sheet !== 'object') {
      fail(file, `sheets[${i}]`, 'must be an object.');
      return;
    }
    if (!isFilledString(sheet.id)) fail(file, `sheets[${i}].id`, 'is missing.');
    else if (!ID_RE.test(sheet.id)) fail(file, at('id'), `must be kebab-case, found ${JSON.stringify(sheet.id)}.`);
    else if (ids.has(sheet.id)) fail(file, at('id'), 'is a duplicate.');
    else ids.add(sheet.id);

    if (!isFilledString(sheet.name)) fail(file, at('name'), 'is missing.');
    if (!isFilledString(sheet.intro)) fail(file, at('intro'), 'is missing.');

    const emojiIssue = emojiProblem(sheet.emoji);
    if (emojiIssue) fail(file, at('emoji'), emojiIssue);

    if (!Array.isArray(sheet.rows) || sheet.rows.length === 0) {
      fail(file, at('rows'), 'needs at least one row.');
    } else {
      sheet.rows.forEach((row, j) => {
        stats.rows += 1;
        const spot = `${label}.rows[${j}]`;
        if (!row || typeof row !== 'object') {
          fail(file, spot, 'must be an object with tier and text.');
          return;
        }
        if (!VARIANT_TIERS.includes(row.tier)) {
          fail(file, `${spot}.tier`, `is ${JSON.stringify(row.tier)}. Use one of: ${VARIANT_TIERS.join(', ')}.`);
        }
        if (!isFilledString(row.text)) fail(file, `${spot}.text`, 'is missing.');
      });
    }

    if (!isFilledStringArray(sheet.asks)) {
      fail(file, at('asks'), 'needs at least one magic question to ask the staff.');
    } else {
      stats.asks += sheet.asks.length;
    }
  });

  return stats;
}

function checkCaffeine(bundle) {
  const file = 'data/caffeine.json';
  const stats = { drinks: 0, limitMg: 0 };

  if (!bundle || typeof bundle !== 'object') {
    fail(file, '(root)', 'must be an object.');
    return stats;
  }
  if (!Number.isFinite(bundle.limitMg) || bundle.limitMg <= 0) {
    fail(file, 'limitMg', `must be a positive number, found ${JSON.stringify(bundle.limitMg)}.`);
  } else {
    stats.limitMg = bundle.limitMg;
  }
  if (!isFilledString(bundle.note)) fail(file, 'note', 'is missing. The bar needs its "averages only" caveat.');

  if (!Array.isArray(bundle.drinks) || bundle.drinks.length === 0) {
    fail(file, 'drinks', 'needs at least one drink.');
    return stats;
  }

  const ids = new Set();
  bundle.drinks.forEach((drink, i) => {
    const label = drink && isFilledString(drink.id) ? drink.id : `drinks[${i}]`;
    stats.drinks += 1;
    if (!drink || typeof drink !== 'object') {
      fail(file, `drinks[${i}]`, 'must be an object with id, name, emoji and mg.');
      return;
    }
    if (!isFilledString(drink.id)) fail(file, `drinks[${i}].id`, 'is missing.');
    else if (!ID_RE.test(drink.id)) fail(file, `${label}.id`, `must be kebab-case, found ${JSON.stringify(drink.id)}.`);
    else if (ids.has(drink.id)) fail(file, `${label}.id`, 'is a duplicate.');
    else ids.add(drink.id);

    if (!isFilledString(drink.name)) fail(file, `${label}.name`, 'is missing.');

    const emojiIssue = emojiProblem(drink.emoji);
    if (emojiIssue) fail(file, `${label}.emoji`, emojiIssue);

    if (!Number.isFinite(drink.mg) || drink.mg < 0) {
      fail(file, `${label}.mg`, `must be a number of milligrams, found ${JSON.stringify(drink.mg)}.`);
    }
  });

  if (Array.isArray(bundle.excluded)) {
    bundle.excluded.forEach((item, i) => {
      if (!item || typeof item !== 'object') {
        fail(file, `excluded[${i}]`, 'must be an object with name and note.');
        return;
      }
      if (!isFilledString(item.name)) fail(file, `excluded[${i}].name`, 'is missing.');
      if (!isFilledString(item.note)) fail(file, `excluded[${i}].note`, 'is missing.');
    });
  }

  return stats;
}

function report(problemList) {
  const byFile = new Map();
  for (const item of problemList) {
    const list = byFile.get(item.file) || [];
    list.push(item);
    byFile.set(item.file, list);
  }

  const count = problemList.length;
  console.error('');
  console.error(`Validation failed: ${count} problem${count === 1 ? '' : 's'}.`);
  for (const [file, list] of byFile) {
    console.error('');
    console.error(`  ${file}`);
    for (const item of list) {
      console.error(`    ${item.where}`);
      console.error(`      ${item.message}`);
    }
  }
  console.error('');
  console.error('Nothing deploys until these are fixed. See docs/ARCHITECTURE.md section 2 for the data contracts.');
  console.error('');
}

function summarise(counts) {
  const { foods, meals, lexicon, sheets, caffeine, sourceKeys, sweep } = counts;
  const groupLines = GROUPS.map((g) => `${g} ${foods.groups.get(g) || 0}`).join(', ');
  const lines = [
    '',
    'Bump Appetit data checks out.',
    '',
    `  foods         ${foods.count} entries: ${foods.tiers.green} green, ${foods.tiers.yellow} yellow, ${foods.tiers.red} red, ${foods.tiers.depends} depends`,
    `  variants      ${foods.variants} across the depends entries`,
    `  aliases       ${foods.aliases} unique search terms`,
    `  groups        ${groupLines}`,
    `  pending       ${foods.flagged} entr${foods.flagged === 1 ? 'y' : 'ies'} flagged for sign-off`,
    `  splits        ${foods.splits} advice-is-split panels, sources quoted side by side`,
    `  meals         ${meals.meals} (${meals.snacks} snacks, ${meals.mains} meals) plus ${meals.swaps} craving swaps`,
    `  lexicon       ${lexicon.terms} terms, ${lexicon.phrases} phrases, ${lexicon.signals} cooked signals`,
    `  cheat sheets  ${sheets.sheets} sheets, ${sheets.rows} rows, ${sheets.asks} magic questions`,
    `  caffeine      ${caffeine.drinks} drinks against a ${caffeine.limitMg}mg daily limit`,
    `  sources       ${sourceKeys.size} registered, ${foods.sourcesUsed.size} in use`,
    `  em dashes     0 across ${sweep.scanned} scanned files`,
    '',
  ];
  console.log(lines.join('\n'));
}

function main() {
  const sources = readJson('data/sources.json');
  const sourceKeys = checkSources(sources);

  const foodsBundle = readJson('data/foods.json');
  const mealsBundle = readJson('data/meals.json');
  const lexiconBundle = readJson('data/lexicon.json');
  const sheetsBundle = readJson('data/cheatsheets.json');
  const caffeineBundle = readJson('data/caffeine.json');

  const foods = checkFoods(foodsBundle, sourceKeys);
  const meals = checkMeals(mealsBundle);
  const lexicon = checkLexicon(lexiconBundle);
  const sheets = checkCheatsheets(sheetsBundle);
  const caffeine = checkCaffeine(caffeineBundle);

  // 5. Em dashes: the data first, with a path, then the rest of the repo by line.
  const bundles = [
    ['data/foods.json', foodsBundle],
    ['data/meals.json', mealsBundle],
    ['data/lexicon.json', lexiconBundle],
    ['data/cheatsheets.json', sheetsBundle],
    ['data/caffeine.json', caffeineBundle],
    ['data/sources.json', sources],
  ];
  for (const [rel, bundle] of bundles) {
    if (bundle) scanJsonForEmDashes(rel, bundle, '');
  }
  const sweep = scanRepoForEmDashes();

  if (problems.length > 0) {
    report(problems);
    process.exit(1);
  }

  summarise({ foods, meals, lexicon, sheets, caffeine, sourceKeys, sweep });
}

main();
