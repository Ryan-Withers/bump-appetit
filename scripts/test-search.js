#!/usr/bin/env node
'use strict';

// Golden query tests. These run the REAL search pipeline: assets/js/search.js and
// assets/js/util.js are imported as native ES modules, exactly as the browser
// loads them, so nothing here can drift from what Emma actually types into.
//
// data.js is skipped on purpose: it fetches over HTTP, which does not exist in
// Node. The harness reads data/entries.json off disk and calls initSearch(entries)
// directly, which is the same input data.js would have handed it.
//
// Run with: node scripts/test-search.js
// Add one row for every search bug ever found, forever.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

/**
 * [query, expectedId, expectedTier]. The expected entry must come back as the
 * TOP result, not merely somewhere in the list: on a phone in a cafe queue,
 * result two might as well not exist.
 */
const GOLDEN = [
  // 1. The things typed at 3am, in the words a frightened person uses.
  ['cluster feeding', 'cluster-feeding', 'normal'],
  ['hiccups', 'hiccups', 'normal'],
  ['cradle cap', 'cradle-cap', 'normal'],
  ['baby acne', 'baby-acne', 'normal'],
  ['first smile', 'first-smile', 'normal'],
  ['witching hour', 'witching-hour', 'normal'],
  ['resettling', 'resettling', 'normal'],
  ['wet nappy count', 'wet-nappy-count', 'normal'],
  ['cord stump care', 'cord-stump-care', 'normal'],

  // 2. The ones that must land on KEEP AN EYE, not on reassurance.
  ['colic', 'colic', 'watch'],
  ['reflux', 'reflux', 'watch'],
  ['silent reflux', 'silent-reflux', 'watch'],
  ['nappy rash', 'nappy-rash', 'watch'],
  ['constipation', 'constipation', 'watch'],
  ['rolling over', 'rolling-over', 'watch'],
  ['attachment and latch', 'attachment-and-latch', 'watch'],
  ['oversupply', 'oversupply', 'watch'],
  ['nipple thrush', 'nipple-thrush', 'watch'],

  // 3. CALL SOMEONE. Getting one of these wrong is the whole risk, so every
  // one of them is pinned by id AND by tier.
  ['mastitis', 'mastitis', 'call'],
  ['fewer wet nappies', 'fewer-wet-nappies', 'call'],
  ['projectile vomiting', 'projectile-vomiting', 'call'],
  ['cord stump infection', 'cord-stump-infection', 'call'],
  ['blood in a nappy', 'blood-in-a-nappy', 'call'],
  ['inconsolable crying', 'inconsolable-crying', 'call'],
  ['breathing oddly in sleep', 'breathing-oddly-in-sleep', 'call'],
  ['nappy thrush', 'nappy-thrush', 'call'],
  ['jaundice and feeding', 'jaundice-and-feeding', 'call'],

  // 4. The genuine two-answer ones.
  ['swaddling', 'swaddling', 'depends'],
  ['bed sharing', 'bed-sharing', 'depends'],
  ['dummy for sleep', 'dummy-for-sleep', 'depends'],
  ['newborn jaundice', 'newborn-jaundice', 'depends'],
  ['posseting', 'posseting-vs-vomiting', 'depends'],
  ['low supply', 'low-supply-worry', 'depends'],
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
  const abs = path.join(ROOT, 'data/entries.json');
  const bundle = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(bundle.entries) || bundle.entries.length === 0) {
    throw new Error('data/entries.json has no entries array. Run node scripts/validate.js first.');
  }
  return bundle.entries;
}

function describe(result) {
  if (!result) return 'nothing';
  return `${result.entry.id} (${result.entry.tier}, ${result.kind}, score ${Number(result.score).toFixed(2)})`;
}

/**
 * Catches fixture rot before it looks like a search bug: a renamed id or a
 * retiered entry should read as "the fixture is stale", not "search broke".
 */
function checkFixtureAgainstData(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seenQueries = new Set();

  for (const [query, expectedId, expectedTier] of GOLDEN) {
    if (seenQueries.has(query)) {
      fail(`Duplicate fixture row: ${JSON.stringify(query)}`, 'The same query is asserted twice. Delete one.');
    }
    seenQueries.add(query);

    const entry = byId.get(expectedId);
    if (!entry) {
      fail(
        `Unknown id in fixture: ${JSON.stringify(expectedId)} (query ${JSON.stringify(query)})`,
        'No entry in data/entries.json has that id. Ids are stable by contract, so either the fixture is stale or an id was renamed.'
      );
      continue;
    }
    if (entry.tier !== expectedTier) {
      fail(
        `Stale tier in fixture: ${expectedId} (query ${JSON.stringify(query)})`,
        `The fixture expects "${expectedTier}" but data/entries.json now says "${entry.tier}". If the retier is deliberate, update this row.`
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

    if (top.entry.id !== expectedId) {
      const runners = outcome.results.slice(1, 4).map((r) => r.entry.id).join(', ') || 'none';
      fail(
        `${JSON.stringify(query)} matched the wrong entry`,
        `expected ${expectedId} (${expectedTier}), got ${describe(top)}. Runners up: ${runners}.`
      );
      continue;
    }

    if (top.entry.tier !== expectedTier) {
      fail(
        `${JSON.stringify(query)} matched ${expectedId} with the wrong tier`,
        `expected ${expectedTier}, got ${top.entry.tier}`
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
function runPipelineChecks(search, browseGroup, entries) {
  const blank = search('   ');
  if (blank.results.length !== 0 || blank.soft !== false) {
    fail('An empty query returned results', 'A blank search box must show the browse tiles, not a list of entries.');
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

  const group = 'Fish & seaentry';
  const rows = browseGroup(group);
  const expected = entries.filter((entry) => entry.group === group).length;
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
  console.error('A wrong top result is a wrong verdict. Fix the aliases in data/entries.json, or fix the fixture if the entry genuinely changed.');
  console.error('');
}

async function main() {
  const { initSearch, search, browseGroup } = await import(moduleUrl('assets/js/search.js'));
  const entries = loadFoods();

  checkFixtureAgainstData(entries);
  initSearch(entries);
  const passed = runGolden(search);
  runPipelineChecks(search, browseGroup, entries);

  if (failures.length > 0) {
    report();
    process.exit(1);
  }

  const depends = new Set(GOLDEN.filter((row) => row[2] === 'depends').map((row) => row[1]));
  const calls = new Set(GOLDEN.filter((row) => row[2] === 'call').map((row) => row[1]));
  console.log('');
  console.log(`Search is honest: ${passed} of ${GOLDEN.length} golden queries returned the right entry, first result.`);
  console.log('');
  console.log(`  indexed       ${entries.length} entries`);
  console.log(`  depends       ${depends.size} ambiguous entries answered "depends"`);
  console.log(`  calls         ${calls.size} call-someone answers landed on the right entry`);
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('Search tests could not run.');
  console.error(`  ${err && err.message ? err.message : err}`);
  console.error('');
  process.exit(1);
});
