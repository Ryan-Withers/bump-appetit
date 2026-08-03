#!/usr/bin/env node
'use strict';

// Golden query tests. These run the REAL search pipeline: assets/js/search.js and
// assets/js/util.js are imported as native ES modules, exactly as the browser
// loads them, so nothing here can drift from what Emma actually types into.
//
// data.js is skipped on purpose: it fetches over HTTP, which does not exist in
// Node. The harness reads data/foods.json off disk and calls initSearch(foods)
// directly, which is the same input data.js would have handed it.
//
// Run with: node scripts/test-search.js
// Add one row for every search bug ever found, forever.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

/**
 * [query, expectedId, expectedTier]. The expected food must come back as the
 * TOP result, not merely somewhere in the list: on a phone in a cafe queue,
 * result two might as well not exist.
 */
const GOLDEN = [
  // 1. The seed set from build spec 8.5.
  ['runny egg', 'eggs-runny', 'red'],
  ['maccas soft serve', 'soft-serve', 'red'],
  ['flake', 'flake', 'yellow'],
  ['proscuitto', 'prosciutto', 'red'],
  ['pav', 'pavlova', 'green'],
  ['can i eat brie', 'brie', 'red'],
  ['salmon', 'salmon', 'depends'],
  ['hommus', 'hummus', 'red'],
  ['jar mayo', 'mayonnaise-jar', 'green'],
  ['chrissy prawns', 'prawns-precooked-cold', 'red'],

  // 2. Australian vernacular. She will not type "chicken parmigiana".
  ['parmy', 'chicken-parmigiana', 'green'],
  ['schnitty', 'chicken-parmigiana', 'green'],
  ['chook', 'bbq-chicken-hot', 'green'],
  ['cold chook', 'bbq-chicken-cold', 'red'],
  ['avo', 'avocado', 'green'],
  ['smashed avo', 'avocado', 'green'],
  ['maccas', 'burgers', 'green'],
  ['snag', 'sausages-cooked', 'green'],
  ['brekkie eggs', 'eggs', 'depends'],
  ['choccy', 'chocolate', 'green'],
  ['hsp', 'kebab', 'yellow'],
  ['cuppa', 'tea', 'yellow'],
  ['bikkies', 'baked-cakes-biscuits', 'green'],
  ['toastie', 'toasted-ham-cheese', 'green'],
  ['jaffle', 'toasted-ham-cheese', 'green'],
  ['devon', 'cold-deli-meats', 'red'],
  ['barra', 'cooked-fish', 'green'],
  ['servo sanga', 'packaged-sandwiches', 'red'],
  ['chrissy stuffing', 'stuffing-in-bird', 'red'],
  ['milo', 'hot-chocolate', 'yellow'],
  ['lambs fry', 'liver', 'yellow'],
  ['bath milk', 'raw-milk-and-cheese', 'red'],

  // 3. Misspellings. Typed one-handed, at 3am, on a phone keyboard.
  ['cambembert', 'brie', 'red'],
  ['camenbert', 'brie', 'red'],
  ['prosciuto', 'prosciutto', 'red'],
  ['humous', 'hummus', 'red'],
  ['flat wite', 'coffee', 'yellow'],
  ['mayonaise', 'mayonnaise', 'depends'],
  ['mushroon', 'mushrooms', 'depends'],
  ['sammon', 'salmon', 'depends'],
  ['canteloupe', 'rockmelon', 'red'],
  ['avacado', 'avocado', 'green'],
  ['susi', 'sushi', 'depends'],
  ['chese', 'cheese', 'depends'],
  ['holandaise', 'hollandaise', 'red'],
  ['eggs benidict', 'eggs-benedict', 'red'],
  ['chocolate moose', 'chocolate-mousse', 'red'],
  ['orange ruffy', 'orange-roughy-catfish', 'yellow'],
  ['seviche', 'ceviche', 'red'],

  // 4. Full questions. The filler stripper has to peel these back to the food.
  ['is sushi safe while pregnant', 'sushi', 'depends'],
  ['are runny eggs ok', 'eggs-runny', 'red'],
  ['can i eat pate', 'pate-refrigerated', 'red'],
  ['is feta ok when pregnant', 'feta-and-ricotta', 'red'],
  ['can i have coffee while pregnant', 'coffee', 'yellow'],
  ['can i eat prawns', 'prawns', 'depends'],
  ['is smoked salmon safe', 'smoked-salmon', 'red'],
  ['can i eat soft serve', 'soft-serve', 'red'],
  ['is hummus safe', 'hummus', 'red'],
  ['can i eat rockmelon while pregnant', 'rockmelon', 'red'],
  ['is it ok to eat sashimi', 'sashimi', 'red'],
  ['can i eat salami', 'cold-deli-meats', 'red'],
  ['are oysters safe while pregnant', 'oysters-raw', 'red'],
  ['is milk ok', 'milk', 'depends'],

  // 5. Every ambiguous food answers "depends" and shows the split. A single
  // wrong tier on one of these is the failure that costs all trust.
  ['cheese', 'cheese', 'depends'],
  ['milk', 'milk', 'depends'],
  ['ham', 'ham', 'depends'],
  ['prawns', 'prawns', 'depends'],
  ['eggs', 'eggs', 'depends'],
  ['mayonnaise', 'mayonnaise', 'depends'],
  ['mushrooms', 'mushrooms', 'depends'],
  ['pho', 'pho', 'depends'],
  ['sushi', 'sushi', 'depends'],
  ['sushi train', 'sushi-train', 'depends'],
  ['salmon fillet', 'salmon', 'depends'],

  // 6. The highest-stakes reds. Getting one of these wrong is the whole risk.
  ['soft serve', 'soft-serve', 'red'],
  ['hollandaise', 'hollandaise', 'red'],
  ['cold deli meat', 'cold-deli-meats', 'red'],
  ['smoked salmon', 'smoked-salmon', 'red'],
  ['pate', 'pate-refrigerated', 'red'],
  ['raw sprouts', 'raw-sprouts', 'red'],
  ['rockmelon', 'rockmelon', 'red'],
  ['hummus', 'hummus', 'red'],
  ['blue cheese', 'blue-cheese', 'red'],
  ['oysters', 'oysters-raw', 'red'],
  ['sashimi', 'sashimi', 'red'],
  ['tiramisu', 'tiramisu', 'red'],
  ['caesar salad', 'caesar-salad', 'red'],
  ['cookie dough', 'cookie-dough', 'red'],
  ['alcohol', 'alcohol', 'red'],
  ['energy drinks', 'energy-drinks', 'red'],
  ['enoki', 'enoki-mushrooms', 'red'],
  ['bocconcini', 'fresh-mozzarella', 'red'],
  ['goats cheese', 'goat-cheese', 'red'],
  ['fetta', 'feta-and-ricotta', 'red'],
  ['leg ham', 'cold-deli-meats', 'red'],
  ['supermarket sushi', 'sushi-store-bought', 'red'],
  ['pre packaged salad', 'salad-bars-packaged', 'red'],
  ['juice bar smoothie', 'cafe-juice-smoothie', 'red'],
  ['rare steak', 'steak-rare', 'red'],
  ['jerky', 'jerky-biltong', 'red'],
  ['eggs benedict', 'eggs-benedict', 'red'],
  ['veggie pate', 'pate-veggie', 'red'],
  ['kibbeh', 'raw-mince-dishes', 'red'],
  ['marinated mussels', 'marinated-mussels', 'red'],
  ['prawn cocktail', 'prawns-precooked-cold', 'red'],

  // 7. The yeses and the limits, because the app is not a wall of no.
  ['pizza', 'pizza', 'green'],
  ['meat pie', 'meat-pie', 'green'],
  ['hot chips', 'hot-chips', 'green'],
  ['fish and chips', 'fish-and-chips', 'green'],
  ['vegemite', 'vegemite', 'green'],
  ['honey', 'honey', 'green'],
  ['decaf', 'decaf-coffee', 'green'],
  ['water', 'water', 'green'],
  ['yoghurt', 'yoghurt', 'green'],
  ['haloumi', 'haloumi', 'green'],
  ['bacon', 'bacon-hot', 'green'],
  ['peanuts', 'peanuts', 'green'],
  ['frozen berries', 'frozen-fruit', 'green'],
  ['canned tuna', 'canned-fish', 'green'],
  ['weet bix', 'bread-cereal-oats', 'green'],
  ['quiche', 'quiche', 'green'],
  ['kebab', 'kebab', 'yellow'],
  ['liver', 'liver', 'yellow'],
  ['gelato', 'gelato-scooped', 'yellow'],
  ['coke', 'cola', 'yellow'],
  ['raspberry leaf tea', 'raspberry-leaf-tea', 'red'],
  ['zero beer', 'zero-alcohol-drinks', 'yellow'],
  ['pad thai', 'pad-thai-stir-fry', 'yellow'],
  ['stevia', 'artificial-sweeteners', 'yellow'],
];

const VALID_KINDS = new Set(['exact-name', 'exact-alias', 'fuzzy']);

const failures = [];

function fail(heading, detail) {
  failures.push({ heading, detail });
}

function moduleUrl(rel) {
  return pathToFileURL(path.join(ROOT, rel)).href;
}

function loadFoods() {
  const abs = path.join(ROOT, 'data/foods.json');
  const bundle = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(bundle.foods) || bundle.foods.length === 0) {
    throw new Error('data/foods.json has no foods array. Run node scripts/validate.js first.');
  }
  return bundle.foods;
}

function describe(result) {
  if (!result) return 'nothing';
  return `${result.food.id} (${result.food.tier}, ${result.kind}, score ${Number(result.score).toFixed(2)})`;
}

/**
 * Catches fixture rot before it looks like a search bug: a renamed id or a
 * retiered food should read as "the fixture is stale", not "search broke".
 */
function checkFixtureAgainstData(foods) {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const seenQueries = new Set();

  for (const [query, expectedId, expectedTier] of GOLDEN) {
    if (seenQueries.has(query)) {
      fail(`Duplicate fixture row: ${JSON.stringify(query)}`, 'The same query is asserted twice. Delete one.');
    }
    seenQueries.add(query);

    const food = byId.get(expectedId);
    if (!food) {
      fail(
        `Unknown id in fixture: ${JSON.stringify(expectedId)} (query ${JSON.stringify(query)})`,
        'No food in data/foods.json has that id. Ids are stable by contract, so either the fixture is stale or an id was renamed.'
      );
      continue;
    }
    if (food.tier !== expectedTier) {
      fail(
        `Stale tier in fixture: ${expectedId} (query ${JSON.stringify(query)})`,
        `The fixture expects "${expectedTier}" but data/foods.json now says "${food.tier}". If the retier is deliberate, update this row.`
      );
    }
  }
}

function runGolden(search) {
  let passed = 0;

  for (const [query, expectedId, expectedTier] of GOLDEN) {
    const outcome = search(query, 5);
    const top = outcome.results[0];

    if (!top) {
      fail(
        `${JSON.stringify(query)} returned nothing`,
        `expected ${expectedId} (${expectedTier}), got no results at all`
      );
      continue;
    }

    if (top.food.id !== expectedId) {
      const runners = outcome.results.slice(1, 4).map((r) => r.food.id).join(', ') || 'none';
      fail(
        `${JSON.stringify(query)} matched the wrong food`,
        `expected ${expectedId} (${expectedTier}), got ${describe(top)}. Runners up: ${runners}.`
      );
      continue;
    }

    if (top.food.tier !== expectedTier) {
      fail(
        `${JSON.stringify(query)} matched ${expectedId} with the wrong tier`,
        `expected ${expectedTier}, got ${top.food.tier}`
      );
      continue;
    }

    if (!VALID_KINDS.has(top.kind)) {
      fail(
        `${JSON.stringify(query)} came back with an unknown result kind`,
        `expected one of ${[...VALID_KINDS].join(', ')}, got ${JSON.stringify(top.kind)}`
      );
      continue;
    }

    passed += 1;
  }

  return passed;
}

/** Cheap invariants that would otherwise only show up as odd UI behaviour. */
function runPipelineChecks(search, browseGroup, foods) {
  const blank = search('   ');
  if (blank.results.length !== 0 || blank.soft !== false) {
    fail('An empty query returned results', 'A blank search box must show the browse tiles, not a list of foods.');
  }

  const gibberish = search('zzqqxwv');
  if (gibberish.results.length > 0 && gibberish.soft !== true) {
    fail(
      'A nonsense query was presented as a confident answer',
      `search("zzqqxwv") returned ${describe(gibberish.results[0])} without the soft flag. Near-miss honesty beats confident wrongness.`
    );
  }

  const capped = search('cheese', 3);
  if (capped.results.length > 3) {
    fail('The result limit was ignored', `search("cheese", 3) returned ${capped.results.length} results.`);
  }

  const group = 'Fish & seafood';
  const rows = browseGroup(group);
  const expected = foods.filter((food) => food.group === group).length;
  if (rows.length !== expected) {
    fail(`browseGroup("${group}") returned the wrong count`, `expected ${expected}, got ${rows.length}`);
  }
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i - 1].popularity < rows[i].popularity) {
      fail(
        `browseGroup("${group}") is not sorted by popularity`,
        `${rows[i - 1].id} (popularity ${rows[i - 1].popularity}) came before ${rows[i].id} (popularity ${rows[i].popularity})`
      );
      break;
    }
  }
}

function report() {
  console.error('');
  console.error(`Search tests failed: ${failures.length} problem${failures.length === 1 ? '' : 's'}.`);
  console.error('');
  for (const item of failures) {
    console.error(`  ${item.heading}`);
    console.error(`    ${item.detail}`);
  }
  console.error('');
  console.error('A wrong top result is a wrong verdict. Fix the aliases in data/foods.json, or fix the fixture if the food genuinely changed.');
  console.error('');
}

async function main() {
  const { initSearch, search, browseGroup } = await import(moduleUrl('assets/js/search.js'));
  const foods = loadFoods();

  checkFixtureAgainstData(foods);
  initSearch(foods);
  const passed = runGolden(search);
  runPipelineChecks(search, browseGroup, foods);

  if (failures.length > 0) {
    report();
    process.exit(1);
  }

  const depends = new Set(GOLDEN.filter((row) => row[2] === 'depends').map((row) => row[1]));
  const reds = new Set(GOLDEN.filter((row) => row[2] === 'red').map((row) => row[1]));
  console.log('');
  console.log(`Search is honest: ${passed} of ${GOLDEN.length} golden queries returned the right food, first result.`);
  console.log('');
  console.log(`  indexed       ${foods.length} foods`);
  console.log(`  depends       ${depends.size} ambiguous foods answered "depends"`);
  console.log(`  reds          ${reds.size} high-stakes reds landed on the right entry`);
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('Search tests could not run.');
  console.error(`  ${err && err.message ? err.message : err}`);
  console.error('');
  process.exit(1);
});
