#!/usr/bin/env node
// Merges data/shards/*.json into data/foods.json.
// The food database is written one category at a time, so this is where the
// shards meet and where cross-shard collisions get caught and resolved.
// Usage: node scripts/merge-shards.js [--write]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARDS = path.join(ROOT, 'data', 'shards');
const OUT = path.join(ROOT, 'data', 'foods.json');

const GROUP_ORDER = [
  'Cheese & dairy',
  'Meat & poultry',
  'Fish & seafood',
  'Eggs',
  'Fruit & veg',
  'Drinks',
  'Pantry & sweets',
  'Takeaway',
];

// Same normalisation the search pipeline uses, so a collision here is a real
// collision at query time and not just a difference in punctuation.
function normalise(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const notes = [];
const problems = [];

function loadShards() {
  if (!fs.existsSync(SHARDS)) {
    console.error(`No shard directory at ${SHARDS}`);
    process.exit(1);
  }
  const files = fs.readdirSync(SHARDS).filter((f) => f.endsWith('.json')).sort();
  const foods = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SHARDS, f), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      problems.push(`${f}: invalid JSON, ${e.message}`);
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : parsed.foods;
    if (!Array.isArray(list)) {
      problems.push(`${f}: expected { "foods": [...] }`);
      continue;
    }
    list.forEach((food) => foods.push({ ...food, _shard: f.replace('.json', '') }));
    notes.push(`${f}: ${list.length} entries`);
  }
  return foods;
}

// Duplicate ids are a hard stop: ids key the favourites in localStorage.
function checkIds(foods) {
  const seen = new Map();
  for (const food of foods) {
    if (seen.has(food.id)) {
      problems.push(`duplicate id "${food.id}" in ${food._shard} and ${seen.get(food.id)}`);
    } else {
      seen.set(food.id, food._shard);
    }
  }
}

// An alias belongs to exactly one food. When two shards claim the same one we
// keep it where it is most specific and drop it elsewhere, rather than failing:
// dropping a duplicate alias never makes search worse, it just removes ambiguity.
function resolveAliases(foods) {
  const nameOwners = new Map();
  for (const food of foods) nameOwners.set(normalise(food.name), food.id);

  const claims = new Map(); // alias -> [food, ...]
  for (const food of foods) {
    const cleaned = [];
    for (const alias of food.aliases || []) {
      const key = normalise(alias);
      if (!key || key.length < 3) {
        notes.push(`dropped short alias "${alias}" from ${food.id}`);
        continue;
      }
      if (cleaned.includes(key)) continue; // duplicate within the same entry
      cleaned.push(key);
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key).push(food);
    }
    food.aliases = cleaned;
  }

  for (const [alias, owners] of claims) {
    // An alias that is another food's name always belongs to that food.
    const nameOwner = nameOwners.get(alias);
    if (nameOwner) {
      for (const food of owners) {
        if (food.id !== nameOwner) {
          food.aliases = food.aliases.filter((a) => a !== alias);
          notes.push(`alias "${alias}" removed from ${food.id}, it is ${nameOwner}'s name`);
        }
      }
      continue;
    }
    if (owners.length < 2) continue;
    // Otherwise the most-searched food keeps it, ties going to the shorter name,
    // which is nearly always the more general entry Emma meant.
    const winner = owners.slice().sort(
      (a, b) => (b.popularity || 1) - (a.popularity || 1) || a.name.length - b.name.length
    )[0];
    for (const food of owners) {
      if (food.id === winner.id) continue;
      food.aliases = food.aliases.filter((a) => a !== alias);
    }
    notes.push(
      `alias "${alias}" contested by ${owners.map((f) => f.id).join(', ')} -> kept on ${winner.id}`
    );
  }
}

function sortFoods(foods) {
  return foods.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name, 'en-AU');
  });
}

const foods = loadShards();
checkIds(foods);
resolveAliases(foods);
sortFoods(foods);

for (const food of foods) {
  if (!GROUP_ORDER.includes(food.group)) {
    problems.push(`${food.id}: group "${food.group}" is not one of the eight canonical groups`);
  }
  delete food._shard;
}

console.log('--- shards ---');
notes.filter((n) => n.includes('.json:')).forEach((n) => console.log('  ' + n));
console.log(`\n--- ${foods.length} foods total ---`);
const byGroup = {};
foods.forEach((f) => {
  byGroup[f.group] = (byGroup[f.group] || 0) + 1;
});
GROUP_ORDER.forEach((g) => console.log(`  ${g}: ${byGroup[g] || 0}`));
const byTier = {};
foods.forEach((f) => {
  byTier[f.tier] = (byTier[f.tier] || 0) + 1;
});
console.log('  tiers:', JSON.stringify(byTier));
console.log(`  aliases: ${foods.reduce((n, f) => n + f.aliases.length, 0)}`);

const resolutions = notes.filter((n) => !n.includes('.json:'));
if (resolutions.length) {
  console.log('\n--- alias resolutions ---');
  resolutions.forEach((n) => console.log('  ' + n));
}

if (problems.length) {
  console.log('\n--- PROBLEMS ---');
  problems.forEach((p) => console.log('  ' + p));
}

if (process.argv.includes('--write')) {
  if (problems.length) {
    console.error('\nRefusing to write foods.json while problems remain.');
    process.exit(1);
  }
  fs.writeFileSync(OUT, JSON.stringify({ schema: 2, foods }, null, 2) + '\n');
  console.log(`\nWrote ${OUT}`);
} else {
  console.log('\n(dry run, pass --write to update data/foods.json)');
}

process.exit(problems.length ? 1 : 0);
