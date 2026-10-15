#!/usr/bin/env node
'use strict';

// The quality gate. Ryan edits data from his phone, so this is the only thing
// standing between a typo on a tram and a wrong answer at 3am.
// Plain Node, zero dependencies: node scripts/validate.js
//
// It fails loudly and specifically: every problem names the file, the id and
// the field, so a fix is obvious without opening a laptop.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TIERS = ['normal', 'watch', 'call', 'depends'];
const VARIANT_TIERS = ['normal', 'watch', 'call'];

const GROUPS = ['Sleep', 'Feeding', 'Crying', 'Nappies', 'Skin & body', 'Illness', 'Milestones', 'You two'];

// Who an entry may send someone to. Closed, because an invented service is a
// phone call that goes nowhere, and the app resolves these against config.
const WHO = ['000', 'GP', 'MCH nurse', 'Nurse line', 'ABA helpline', 'Red Nose line'];

const BUY_CATEGORIES = ['must', 'soon', 'later', 'maybe', 'borrow'];
const BUY_GROUPS = ['Sleep', 'Feeding', 'Out and about', 'Changing', 'Bathing', 'Clothing', 'Nursery', 'Health'];

const WHY_MAX = 220;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Written as escapes on purpose, so this file passes its own sweep.
const EM_DASH = /[\u2014\u2015\u2E3A\u2E3B]/;
const EM_DASH_GLOBAL = /[\u2014\u2015\u2E3A\u2E3B]/g;

const SCAN_DIRS = ['assets', 'data', 'worker', 'scripts', '.github', 'docs'];
const SCAN_SKIP = new Set(['.git', 'node_modules', 'vendor', 'fonts', 'icons']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.webmanifest']);

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const problems = [];

function fail(file, where, message) { problems.push({ file, where, message }); }
const filled = (v) => typeof v === 'string' && v.trim().length > 0;

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (err) {
    fail(rel, '(file)', `could not be read: ${err.message}`);
    return null;
  }
}

function emojiProblem(value) {
  if (!filled(value)) return 'is missing. Every entry carries exactly one emoji.';
  if (value !== value.trim()) return `has spaces around it: ${JSON.stringify(value)}`;
  const count = Array.from(graphemes.segment(value)).length;
  if (count !== 1) return `must be exactly one emoji, found ${count}: ${JSON.stringify(value)}`;
  if (!/\p{Extended_Pictographic}/u.test(value)) return `is not an emoji: ${JSON.stringify(value)}`;
  return null;
}

function checkLen(file, where, value, max) {
  if (filled(value) && value.length > max) {
    fail(file, where, `is ${value.length} characters, over the ${max} limit.`);
  }
}

/* ---------------------------------------------------------------- entries */

function checkEntries(bundle, sourceKeys) {
  const file = 'data/entries.json';
  const entries = bundle && bundle.entries;
  if (!Array.isArray(entries)) { fail(file, '(root)', 'has no entries array.'); return { count: 0 }; }

  const ids = new Set();
  const aliases = new Map();
  const names = new Map();
  const stats = { normal: 0, watch: 0, call: 0, depends: 0 };

  for (const entry of entries) {
    const id = entry && entry.id;
    const at = (field) => `${id || '(no id)'}.${field}`;

    if (!filled(id) || !ID_RE.test(id)) { fail(file, at('id'), 'must be kebab-case.'); continue; }
    if (ids.has(id)) fail(file, at('id'), 'is used twice.');
    ids.add(id);

    if (!filled(entry.name)) {
      fail(file, at('name'), 'is missing.');
    } else {
      // Two entries with the same name is a duplicate wearing different ids,
      // and whichever one search picks, the other is unreachable.
      const key = entry.name.trim().toLowerCase();
      if (names.has(key)) fail(file, at('name'), `is also the name of "${names.get(key)}".`);
      names.set(key, id);
    }

    const emoji = emojiProblem(entry.emoji);
    if (emoji) fail(file, at('emoji'), emoji);

    if (!GROUPS.includes(entry.group)) {
      fail(file, at('group'), `is ${JSON.stringify(entry.group)}. Use one of: ${GROUPS.join(', ')}.`);
    }

    if (!TIERS.includes(entry.tier)) {
      fail(file, at('tier'), `is ${JSON.stringify(entry.tier)}. Use: ${TIERS.join(', ')}.`);
    } else stats[entry.tier] += 1;

    if (!filled(entry.why)) fail(file, at('why'), 'is missing.');
    checkLen(file, at('why'), entry.why, WHY_MAX);
    checkLen(file, at('whatToDo'), entry.whatToDo, WHY_MAX);

    // The rule the app is built on: a CALL answer always names who to ring,
    // and nothing else pretends to.
    if (entry.tier === 'call') {
      if (!WHO.includes(entry.whoToCall)) {
        fail(file, at('whoToCall'), `is ${JSON.stringify(entry.whoToCall)}. A call entry must name one of: ${WHO.join(', ')}.`);
      }
    } else if (entry.whoToCall) {
      fail(file, at('whoToCall'), 'is set on an entry that is not a call. Only call entries name a number.');
    }

    if (entry.tier === 'depends') {
      const variants = Array.isArray(entry.variants) ? entry.variants : [];
      if (variants.length < 2) fail(file, at('variants'), 'needs at least 2 on a depends entry.');
      variants.forEach((v, i) => {
        if (!filled(v && v.label)) fail(file, at(`variants[${i}].label`), 'is missing.');
        if (!VARIANT_TIERS.includes(v && v.tier)) {
          fail(file, at(`variants[${i}].tier`), `must be one of: ${VARIANT_TIERS.join(', ')}.`);
        }
        checkLen(file, at(`variants[${i}].why`), v && v.why, WHY_MAX);
      });
    } else if (Array.isArray(entry.variants) && entry.variants.length) {
      fail(file, at('variants'), 'is only for depends entries.');
    }

    const list = Array.isArray(entry.aliases) ? entry.aliases : [];
    if (!list.length) fail(file, at('aliases'), 'needs at least one.');
    for (const alias of list) {
      const clean = String(alias);
      if (clean !== clean.toLowerCase().trim()) fail(file, at('aliases'), `"${clean}" must be lowercase and trimmed.`);
      if (clean.length < 3) fail(file, at('aliases'), `"${clean}" is too short.`);
      if (aliases.has(clean)) fail(file, at('aliases'), `"${clean}" is already used by ${aliases.get(clean)}.`);
      aliases.set(clean, id);
    }

    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    if (!sources.length) fail(file, at('sources'), 'needs at least one source key.');
    for (const key of sources) {
      if (!sourceKeys.has(key)) fail(file, at('sources'), `"${key}" is not in sources.json.`);
    }

    // The link is what keeps this legal and current: our words, their page.
    if (!filled(entry.link) || !/^https:\/\//.test(entry.link)) {
      fail(file, at('link'), 'must be an https link back to the page it came from.');
    }

    if (!MONTH_RE.test(entry.reviewed)) fail(file, at('reviewed'), 'must be YYYY-MM.');
    const pop = Number(entry.popularity);
    if (!(pop >= 1 && pop <= 3)) fail(file, at('popularity'), 'must be 1, 2 or 3.');
  }

  // An alias may not shadow a different entry's name, or the better match loses.
  for (const [alias, owner] of aliases) {
    const named = names.get(alias);
    if (named && named !== owner) {
      fail(file, `${owner}.aliases`, `"${alias}" is the name of "${named}". An alias may not shadow another entry's name.`);
    }
  }

  return { count: entries.length, aliases: aliases.size, stats };
}

/* ------------------------------------------------------------ the rest */

function checkWeeks(bundle, howtoIds) {
  const file = 'data/weeks.json';
  const weeks = bundle && bundle.weeks;
  if (!Array.isArray(weeks)) { fail(file, '(root)', 'has no weeks array.'); return 0; }

  let last = -Infinity;
  for (const week of weeks) {
    const at = (f) => `week ${week && week.week}.${f}`;
    if (!Number.isFinite(week && week.week)) { fail(file, '(entry)', 'has no week number.'); continue; }
    if (week.week <= last) fail(file, at('week'), 'is out of order. Weeks must ascend.');
    last = week.week;
    if (!filled(week.title)) fail(file, at('title'), 'is missing.');
    checkLen(file, at('headline'), week.headline, 120);
    for (const id of (Array.isArray(week.learn) ? week.learn : [])) {
      if (!howtoIds.has(id)) fail(file, at('learn'), `"${id}" is not a how-to id.`);
    }
    for (const focus of (Array.isArray(week.focuses) ? week.focuses : [])) {
      checkLen(file, at('focuses'), focus, 90);
    }
  }
  return weeks.length;
}

function checkStages(bundle, howtoIds) {
  const file = 'data/stages.json';
  const stages = bundle && bundle.stages;
  if (!Array.isArray(stages)) { fail(file, '(root)', 'has no stages array.'); return 0; }

  let expect = 0;
  for (const stage of stages) {
    const at = (f) => `${stage && stage.id}.${f}`;
    if (!filled(stage.id)) { fail(file, '(entry)', 'has no id.'); continue; }
    // A gap between bands is a day with no stage, which the Week tab cannot show.
    if (stage.fromDay !== expect) fail(file, at('fromDay'), `is ${stage.fromDay}, expected ${expect}. Bands must be continuous.`);
    expect = stage.toDay + 1;
    const ids = new Set();
    for (const item of (Array.isArray(stage.checklist) ? stage.checklist : [])) {
      if (ids.has(item.id)) fail(file, at('checklist'), `"${item.id}" is used twice in this band.`);
      ids.add(item.id);
      checkLen(file, at(`checklist.${item.id}`), item.text, 90);
      if (item.howto && !howtoIds.has(item.howto)) {
        fail(file, at(`checklist.${item.id}.howto`), `"${item.howto}" is not a how-to id.`);
      }
    }
  }
  return stages.length;
}

function checkHowtos(bundle) {
  const file = 'data/howtos.json';
  const howtos = bundle && bundle.howtos;
  if (!Array.isArray(howtos)) { fail(file, '(root)', 'has no howtos array.'); return new Set(); }

  const ids = new Set();
  for (const howto of howtos) {
    const at = (f) => `${howto && howto.id}.${f}`;
    if (!filled(howto.id) || !ID_RE.test(howto.id)) { fail(file, '(entry)', 'has a bad id.'); continue; }
    if (ids.has(howto.id)) fail(file, at('id'), 'is used twice.');
    ids.add(howto.id);
    const emoji = emojiProblem(howto.emoji);
    if (emoji) fail(file, at('emoji'), emoji);
    checkLen(file, at('oneLiner'), howto.oneLiner, 70);
    checkLen(file, at('when'), howto.when, 120);
    checkLen(file, at('watchOut'), howto.watchOut, 160);
    const steps = Array.isArray(howto.steps) ? howto.steps : [];
    if (steps.length < 3) fail(file, at('steps'), 'needs at least 3.');
  }
  return ids;
}

function checkBuylist(bundle) {
  const file = 'data/buylist.json';
  const items = bundle && bundle.buylist;
  if (!Array.isArray(items)) { fail(file, '(root)', 'has no buylist array.'); return { count: 0 }; }

  const ids = new Set();
  let mustLow = 0;
  let mustHigh = 0;
  for (const item of items) {
    const at = (f) => `${item && item.id}.${f}`;
    if (!filled(item.id) || !ID_RE.test(item.id)) { fail(file, '(entry)', 'has a bad id.'); continue; }
    if (ids.has(item.id)) fail(file, at('id'), 'is used twice.');
    ids.add(item.id);
    if (!BUY_CATEGORIES.includes(item.category)) fail(file, at('category'), `must be one of: ${BUY_CATEGORIES.join(', ')}.`);
    if (!BUY_GROUPS.includes(item.group)) fail(file, at('group'), `must be one of: ${BUY_GROUPS.join(', ')}.`);
    const low = Number(item.priceLow);
    const high = Number(item.priceHigh);
    if (!Number.isInteger(low) || low < 0) fail(file, at('priceLow'), 'must be a whole number of dollars.');
    if (!Number.isInteger(high) || high < low) fail(file, at('priceHigh'), 'must be at least priceLow.');
    checkLen(file, at('note'), item.note, 140);
    if (item.category === 'must') { mustLow += low; mustHigh += high; }
  }
  return { count: items.length, mustLow, mustHigh };
}

function checkSheets(bundle, sourceKeys) {
  const file = 'data/cheatsheets.json';
  const sheets = bundle && bundle.sheets;
  if (!Array.isArray(sheets)) { fail(file, '(root)', 'has no sheets array.'); return 0; }

  let rows = 0;
  const ids = new Set();
  for (const sheet of sheets) {
    const at = (f) => `${sheet && sheet.id}.${f}`;
    if (!filled(sheet.id)) { fail(file, '(entry)', 'has no id.'); continue; }
    if (ids.has(sheet.id)) fail(file, at('id'), 'is used twice.');
    ids.add(sheet.id);
    for (const key of (Array.isArray(sheet.sources) ? sheet.sources : [])) {
      if (!sourceKeys.has(key)) fail(file, at('sources'), `"${key}" is not in sources.json.`);
    }
    for (const row of (Array.isArray(sheet.rows) ? sheet.rows : [])) {
      rows += 1;
      checkLen(file, at('rows.label'), row.label, 60);
      checkLen(file, at('rows.value'), row.value, 120);
      if (row.tier !== null && row.tier !== undefined && !TIERS.includes(row.tier)) {
        fail(file, at('rows.tier'), `is ${JSON.stringify(row.tier)}.`);
      }
    }
  }
  // The one sheet the app routes to by id.
  if (!ids.has('ring-now')) fail(file, '(root)', 'must contain a sheet with id "ring-now".');
  return rows;
}

/* ------------------------------------------------------------- em dashes */

function scanTree(rel, node, trail) {
  if (typeof node === 'string') {
    if (EM_DASH.test(node)) fail(rel, trail, `contains an em dash: ${JSON.stringify(node.slice(0, 80))}`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const key = item && typeof item === 'object' && filled(item.id) ? item.id : String(i);
      scanTree(rel, item, `${trail}[${key}]`);
    });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) scanTree(rel, value, trail ? `${trail}.${key}` : key);
  }
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SCAN_SKIP.has(entry.name)) walk(abs, out); }
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(abs);
  }
  return out;
}

function scanRepo() {
  const files = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);
  for (const name of fs.readdirSync(ROOT)) {
    const abs = path.join(ROOT, name);
    if (fs.statSync(abs).isFile() && TEXT_EXT.has(path.extname(name).toLowerCase())) files.push(abs);
  }
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel.startsWith('data/') && rel.endsWith('.json')) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (!EM_DASH.test(text)) continue;
    text.split('\n').forEach((line, i) => {
      EM_DASH_GLOBAL.lastIndex = 0;
      const hit = EM_DASH_GLOBAL.exec(line);
      if (hit) fail(rel, `line ${i + 1}`, `em dash found: ${line.trim().slice(0, 80)}`);
    });
  }
  return files.length;
}

/* ------------------------------------------------------------------ main */

const sources = readJson('data/sources.json');
const sourceKeys = new Set(Object.keys((sources && sources.sources) || {}));
if (!sourceKeys.size) fail('data/sources.json', '(root)', 'has no sources.');

const entriesBundle = readJson('data/entries.json');
const weeksBundle = readJson('data/weeks.json');
const stagesBundle = readJson('data/stages.json');
const howtosBundle = readJson('data/howtos.json');
const sheetsBundle = readJson('data/cheatsheets.json');
const buyBundle = readJson('data/buylist.json');

const howtoIds = checkHowtos(howtosBundle);
const entries = checkEntries(entriesBundle, sourceKeys);
const weeks = checkWeeks(weeksBundle, howtoIds);
const stages = checkStages(stagesBundle, howtoIds);
const rows = checkSheets(sheetsBundle, sourceKeys);
const buy = checkBuylist(buyBundle);

for (const [rel, bundle] of [
  ['data/entries.json', entriesBundle], ['data/weeks.json', weeksBundle],
  ['data/stages.json', stagesBundle], ['data/howtos.json', howtosBundle],
  ['data/cheatsheets.json', sheetsBundle], ['data/buylist.json', buyBundle],
]) if (bundle) scanTree(rel, bundle, '');

const scanned = scanRepo();

if (problems.length) {
  console.log(`Validation failed: ${problems.length} problem${problems.length > 1 ? 's' : ''}.\n`);
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const p of list.slice(0, 20)) console.log(`    ${p.where}\n      ${p.message}`);
    if (list.length > 20) console.log(`    ...and ${list.length - 20} more`);
  }
  console.log('\nNothing deploys until these are fixed.');
  process.exit(1);
}

const s = entries.stats || {};
console.log('Bub Appetit data checks out.\n');
console.log(`  entries       ${entries.count}: ${s.normal} normal, ${s.watch} keep an eye, ${s.call} call someone, ${s.depends} depends`);
console.log(`  aliases       ${entries.aliases} search terms`);
console.log(`  weeks         ${weeks} week entries`);
console.log(`  stages        ${stages} bands`);
console.log(`  how-tos       ${howtoIds.size}`);
console.log(`  cheat sheets  ${rows} rows`);
console.log(`  buy list      ${buy.count} items, day one $${buy.mustLow} to $${buy.mustHigh}`);
console.log(`  sources       ${sourceKeys.size} registered`);
console.log(`  em dashes     0 across ${scanned} scanned files`);
