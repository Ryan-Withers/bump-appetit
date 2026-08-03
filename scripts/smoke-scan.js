#!/usr/bin/env node
// The only test that exercises the whole scanner chain for real: the deployed
// Worker, the passphrase, the KV counter, a live vision-model call, and the
// response validator. Everything else in this repo runs against a fake model.
//
// It costs about half a cent per run and makes a real charge against MODEL_KEY,
// so it is never wired into CI on push. Run it by hand from the Actions tab
// after changing the system prompt, the model, or the Worker.
//
// Run: node scripts/smoke-scan.js [path/to/menu.jpg]
//
// Endpoint and passphrase are read out of assets/js/config.js rather than from
// environment variables, so this tests exactly what the app ships with. A
// mismatch between config.js and the Worker's PASS secret is precisely the
// failure this is meant to catch.

import { readFileSync } from 'node:fs';

const FIXTURE = process.argv[2] || 'tests/fixtures/menu.jpg';

/* ------------------------------------------------------------ expectations */

// Written against the Royal Women's Hospital and NSW Food Authority positions
// the app is built on, and matched against the dish name the model returns
// rather than the exact wording on the menu.
//
// The asymmetry is deliberate. A red called green could put her in hospital, so
// those are hard failures. A green called unsure is only annoying, so it is a
// warning: an over-cautious scanner is still a safe scanner.
const EXPECT = [
  // The unambiguous reds. Getting any of these wrong is the whole app failing.
  { match: /p[âa]t[ée]|liver/i, tier: ['red'], label: 'chicken liver pate' },
  { match: /prawn/i, tier: ['red'], label: 'cold prawn cocktail' },
  { match: /prosciutto|rockmelon|melon/i, tier: ['red'], label: 'prosciutto and rockmelon' },
  { match: /benedict|hollandaise/i, tier: ['red'], label: 'eggs benedict' },
  { match: /caesar/i, tier: ['red'], label: 'caesar salad' },
  { match: /soft serve|sundae/i, tier: ['red'], label: 'soft serve' },
  { match: /tiramisu/i, tier: ['red'], label: 'tiramisu' },
  { match: /kombucha/i, tier: ['red'], label: 'kombucha' },

  // Fine with a limit, and saying so is the point: calling flake plain red
  // would be wrong, and calling it green would be worse.
  { match: /flake/i, tier: ['yellow', 'red'], label: 'flake (shark)' },
  { match: /flat white|long black|coffee/i, tier: ['yellow'], label: 'coffee' },

  // Must not be waved through as green. Red or unsure are both acceptable
  // answers here, because the menu genuinely does not settle them.
  { match: /smashed avo|avocado/i, tier: ['red', 'unsure', 'yellow'], label: 'smashed avo with fetta and poached egg' },
  { match: /squid|calamari/i, tier: ['red', 'unsure'], label: 'squid with aioli' },
  { match: /scotch|fillet steak|steak/i, tier: ['red', 'unsure', 'yellow', 'green'], label: 'scotch fillet', soft: true },

  // Safe, and should be recognised as safe. Only a warning if it comes back
  // unsure, because over-caution costs her a meal, not her health.
  { match: /barramundi/i, tier: ['green'], label: 'grilled barramundi', soft: true },
  { match: /toastie|toasted/i, tier: ['green'], label: 'ham and cheese toastie', soft: true },
];

/* ------------------------------------------------------------------ config */

function readConfig() {
  const src = readFileSync('assets/js/config.js', 'utf8');
  const grab = (key) => {
    const hit = new RegExp(`${key}\\s*:\\s*'([^']*)'`).exec(src);
    return hit ? hit[1] : '';
  };
  return { endpoint: grab('endpoint'), pass: grab('pass') };
}

/* -------------------------------------------------------------------- main */

const problems = [];
const warnings = [];

(async () => {
  const { endpoint, pass } = readConfig();
  if (!endpoint) {
    console.error('CONFIG.scanner.endpoint is empty. Nothing to smoke test.');
    process.exit(2);
  }
  console.log(`POST ${endpoint}`);
  console.log(`menu ${FIXTURE}`);

  const image = readFileSync(FIXTURE).toString('base64');
  console.log(`image ${Math.round(image.length / 1024)}KB base64\n`);

  const started = Date.now();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bump-pass': pass },
    body: JSON.stringify({ image }),
  });

  const elapsed = Date.now() - started;
  const body = await res.json().catch(() => null);

  if (!res.ok || !body || !Array.isArray(body.dishes)) {
    console.error(`FAILED: HTTP ${res.status} in ${elapsed}ms`);
    console.error(JSON.stringify(body, null, 2));
    // A bad passphrase and a bad model key look identical from out here, so
    // name both rather than guess.
    if (res.status === 401) console.error('\n401: CONFIG.scanner.pass does not match the Worker PASS secret.');
    if (res.status === 503) console.error('\n503: no MODEL_KEY secret is set on the Worker.');
    if (res.status === 502) console.error('\n502: the model call failed or its answer did not validate. Check the Worker logs.');
    process.exit(1);
  }

  console.log(`${body.dishes.length} dishes in ${elapsed}ms\n`);
  const pad = Math.max(...body.dishes.map((d) => d.dish.length));
  for (const d of body.dishes) {
    console.log(`  ${d.tier.toUpperCase().padEnd(7)} ${d.dish.padEnd(pad)}  ${d.why}`);
    if (d.makeItGreen) console.log(`  ${''.padEnd(7)} ${''.padEnd(pad)}  -> ${d.makeItGreen}`);
  }
  console.log();

  /* ------------------------------------------------------------- assertions */

  for (const want of EXPECT) {
    const hit = body.dishes.find((d) => want.match.test(d.dish));
    if (!hit) {
      (want.soft ? warnings : problems).push(`not found on the menu at all: ${want.label}`);
      continue;
    }
    if (!want.tier.includes(hit.tier)) {
      const line = `${want.label}: got ${hit.tier}, expected ${want.tier.join(' or ')}  ("${hit.dish}": ${hit.why})`;
      // Over-caution is never a failure. Under-caution always is.
      const overCautious = want.tier.includes('green') && hit.tier === 'unsure';
      (want.soft || overCautious ? warnings : problems).push(line);
    }
  }

  // Every red needs a way forward. This is a non-negotiable in the build spec
  // and the whole reason the app is not just a list of things she cannot eat.
  const bareReds = body.dishes.filter((d) => d.tier === 'red' && !d.why.trim());
  if (bareReds.length) {
    problems.push(`${bareReds.length} red verdicts with no reason given: ${bareReds.map((d) => d.dish).join(', ')}`);
  }

  const invented = body.dishes.filter((d) => !/[a-z]/i.test(d.dish));
  if (invented.length) problems.push(`${invented.length} dishes with no readable name`);

  /* ---------------------------------------------------------------- report */

  if (warnings.length) {
    console.log('WARNINGS (over-caution, or wording drift):');
    warnings.forEach((w) => console.log(`  - ${w}`));
    console.log();
  }

  if (problems.length) {
    console.log('FAILURES:');
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log(`\n${problems.length} failure(s). A red called safe is the one thing this app must never do.`);
    process.exit(1);
  }

  console.log(`Every expectation met across ${body.dishes.length} dishes, ${warnings.length} warning(s).`);
})().catch((error) => {
  console.error('smoke test error:', error && error.message);
  process.exit(2);
});
