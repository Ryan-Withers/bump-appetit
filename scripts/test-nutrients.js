#!/usr/bin/env node
// The nutrient browse index, tested against the real data.
//
// This runs the REAL indexNutrients() out of assets/js/data.js, imported as a
// native ES module exactly as the browser loads it, over the real
// data/foods.json. Nothing here is a re-implementation, so it cannot drift.
//
// The rule this file exists to defend: a `low` chip means "people think this is
// a source and it is not". Spinach is marked low on iron precisely because
// everyone believes otherwise. If low ever leaks into a browse list, the app
// starts telling her the exact lie the chip was written to correct.
//
// Run: node scripts/test-nutrients.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  :: ${detail}` : ''}`);
}

const { indexNutrients } = await import(pathToFileURL(path.join(ROOT, 'assets/js/data.js')).href);
const { NUTRIENTS, BROWSABLE_LEVELS } = await import(pathToFileURL(path.join(ROOT, 'assets/js/nutrients.js')).href);

const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8')).foods;
const index = indexNutrients(foods);

const TIER_ORDER = ['green', 'depends', 'yellow', 'red'];

/* ------------------------------------------------------ the low-leak rule */

const lows = [];
for (const food of foods) {
  for (const { key } of NUTRIENTS) {
    if (food.nutrients && food.nutrients[key] === 'low') lows.push([food.id, key]);
  }
}
check('the data still carries low chips worth defending against', lows.length > 0, `${lows.length} found`);

let leaked = [];
for (const [id, key] of lows) {
  const buckets = index.get(key);
  const inList = [...buckets.high, ...buckets.med].some((food) => food.id === id);
  if (inList) leaked.push(`${id}/${key}`);
}
check('no food marked low on a nutrient appears in that nutrient list', leaked.length === 0, leaked.join(', '));

// The canonical case, named out loud so a future edit cannot quietly lose it.
const spinach = foods.find((food) => food.id === 'spinach');
if (spinach && spinach.nutrients && spinach.nutrients.iron === 'low') {
  const iron = index.get('iron');
  check('spinach is absent from the iron list, which is the whole point',
    ![...iron.high, ...iron.med].some((food) => food.id === 'spinach'));
  check('and spinach is still present in the folate list it genuinely belongs to',
    [...index.get('folate').high, ...index.get('folate').med].some((food) => food.id === 'spinach'));
}

/* -------------------------------------------------- everything listed earns it */

let mislabelled = [];
for (const { key } of NUTRIENTS) {
  const buckets = index.get(key);
  for (const level of BROWSABLE_LEVELS) {
    for (const food of buckets[level]) {
      if (!food.nutrients || food.nutrients[key] !== level) {
        mislabelled.push(`${food.id} in ${key}.${level}`);
      }
    }
  }
}
check('every food in a list actually carries that nutrient at that level',
  mislabelled.length === 0, mislabelled.slice(0, 5).join(', '));

/* ----------------------------------------------------------------- ordering */

let misordered = [];
for (const { key } of NUTRIENTS) {
  for (const level of BROWSABLE_LEVELS) {
    const list = index.get(key)[level];
    for (let i = 1; i < list.length; i += 1) {
      const before = TIER_ORDER.indexOf(list[i - 1].tier);
      const after = TIER_ORDER.indexOf(list[i].tier);
      if (before > after) misordered.push(`${key}.${level}: ${list[i - 1].id} before ${list[i].id}`);
    }
  }
}
check('safest first: green, then depends, then limit, then benched',
  misordered.length === 0, misordered.slice(0, 3).join(' | '));

// Reds belong in the list, they just come last. Hiding them would silently
// narrow the answer, and their craving fix is one tap away.
const ironAll = [...index.get('iron').high, ...index.get('iron').med];
check('red foods are still listed, not hidden',
  ironAll.some((food) => food.tier === 'red'),
  `${ironAll.filter((f) => f.tier === 'red').length} reds in iron`);

// Within one bucket, no red may outrank a green. Across buckets it may and
// should: a red that is packed with iron is a better answer to "where is the
// iron" than a green with a merely decent hit, and the two sit under separate
// headings anyway, so nothing is being compared that she cannot see.
let outranked = [];
for (const { key } of NUTRIENTS) {
  for (const level of BROWSABLE_LEVELS) {
    const tiers = index.get(key)[level].map((food) => food.tier);
    const lastGreen = tiers.lastIndexOf('green');
    const firstRed = tiers.indexOf('red');
    if (firstRed !== -1 && lastGreen !== -1 && firstRed < lastGreen) {
      outranked.push(`${key}.${level}`);
    }
  }
}
check('and inside one heading, no red outranks a green',
  outranked.length === 0, outranked.join(', '));

/* ------------------------------------------------------------- determinism */

const again = indexNutrients(foods);
const sameTwice = NUTRIENTS.every(({ key }) => BROWSABLE_LEVELS.every((level) => (
  index.get(key)[level].map((f) => f.id).join() === again.get(key)[level].map((f) => f.id).join()
)));
check('the same data indexes to the same order every time', sameTwice);

/* ---------------------------------------------------------------- coverage */

const empty = NUTRIENTS
  .filter(({ key }) => index.get(key).high.length + index.get(key).med.length === 0)
  .map(({ key }) => key);
check('every nutrient chip has foods behind it, so no chip opens a dead end',
  empty.length === 0, empty.join(', '));

console.log('');
for (const { key, label } of NUTRIENTS) {
  const buckets = index.get(key);
  console.log(`  ${label.padEnd(9)} ${String(buckets.high.length).padStart(3)} packed, ${String(buckets.med.length).padStart(3)} decent`);
}

console.log('');
if (failures.length) {
  console.log(`Nutrient browse failed: ${failures.length} problem${failures.length > 1 ? 's' : ''}.`);
  for (const failure of failures) console.log(`  - ${failure}`);
  console.log('\nA browse list that lies about a nutrient is worse than no list.');
  process.exit(1);
}
console.log(`Nutrient browse checks out: ${passed}/${passed} passed.`);
