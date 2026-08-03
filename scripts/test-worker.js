#!/usr/bin/env node
// Exercises the scanner Worker against a fake vision model.
//
// Everything except the real model call is covered here: CORS and preflight,
// the passphrase, the daily KV quota, the image size cap, and the response
// validator that stands between a hallucinating model and a verdict Emma
// reads. Node 22 has Request/Response/fetch built in, so this needs no
// dependencies and no Cloudflare account.
//
// Run: node scripts/test-worker.js

import worker from '../worker/scan-worker.js';

const ORIGIN = 'https://ryan-withers.github.io';
const PASS = 'test-pass';

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  :: ${detail}` : ''}`);
}

/** A KV stand-in with just the surface the Worker uses. */
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function env(over = {}) {
  return {
    PASS,
    MODEL_KEY: 'fake-key',
    ALLOWED_ORIGIN: ORIGIN,
    KV: fakeKV(),
    ...over,
  };
}

function post(body, { origin = ORIGIN, pass = PASS, method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (pass !== null) headers['x-bump-pass'] = pass;
  return new Request('https://bump-scan.example.workers.dev/', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

/** Swaps global fetch for one that returns a canned Gemini-shaped reply. */
function withModel(replyText, fn, { status = 200 } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: replyText }] } }],
  }), { status, headers: { 'content-type': 'application/json' } });
  return fn().finally(() => { globalThis.fetch = real; });
}

const GOOD = JSON.stringify({
  dishes: [
    { dish: 'Eggs Benedict', tier: 'red', why: 'Hollandaise is a raw-egg sauce.', makeItGreen: 'Ask for firm eggs, no hollandaise.' },
    { dish: 'Grilled barramundi', tier: 'green', why: 'Cooked through and served hot.', makeItGreen: '' },
  ],
});

const IMAGE = 'x'.repeat(2000);

(async () => {
  /* ----------------------------------------------------------------- CORS */

  const pre = await worker.fetch(post(null, { method: 'OPTIONS' }), env());
  check('OPTIONS preflight is answered', pre.status === 204 || pre.status === 200, `status ${pre.status}`);
  check('preflight echoes the allowed origin',
    pre.headers.get('access-control-allow-origin') === ORIGIN,
    pre.headers.get('access-control-allow-origin'));
  check('preflight allows the x-bump-pass header',
    /x-bump-pass/i.test(pre.headers.get('access-control-allow-headers') || ''),
    pre.headers.get('access-control-allow-headers'));

  const eviln = await worker.fetch(post({ image: IMAGE }, { origin: 'https://evil.example' }), env());
  check('a foreign origin is refused', eviln.status === 403, `status ${eviln.status}`);
  check('and is never echoed back in CORS',
    eviln.headers.get('access-control-allow-origin') !== 'https://evil.example',
    eviln.headers.get('access-control-allow-origin'));

  const wildcard = await worker.fetch(post({ image: IMAGE }), env({ ALLOWED_ORIGIN: '' }));
  check('with ALLOWED_ORIGIN unset a browser request fails closed', wildcard.status === 403);

  /* ------------------------------------------------------------- the pass */

  check('no passphrase is rejected',
    (await worker.fetch(post({ image: IMAGE }, { pass: null }), env())).status === 401);
  check('a wrong passphrase is rejected',
    (await worker.fetch(post({ image: IMAGE }, { pass: 'nope' }), env())).status === 401);
  check('with no PASS secret set, nothing gets through',
    (await worker.fetch(post({ image: IMAGE }), env({ PASS: '' }))).status === 401);

  /* -------------------------------------------------------------- method */

  const got = await worker.fetch(new Request('https://x/', { method: 'GET', headers: { Origin: ORIGIN } }), env());
  check('GET is refused with an Allow header', got.status === 405 && /POST/.test(got.headers.get('allow') || ''));

  /* --------------------------------------------------------------- image */

  await withModel(GOOD, async () => {
    check('a missing image is a bad-image, not a crash',
      (await worker.fetch(post({}), env())).status === 400);
    check('a non-JSON body is a bad-image',
      (await worker.fetch(new Request('https://x/', {
        method: 'POST',
        headers: { Origin: ORIGIN, 'x-bump-pass': PASS },
        body: 'not json',
      }), env())).status === 400);
    const huge = await worker.fetch(post({ image: 'y'.repeat(9_000_000) }), env());
    check('an oversized image is refused before the model is called', huge.status === 400, `status ${huge.status}`);
  });

  /* --------------------------------------------------------------- quota */

  const today = new Date().toISOString().slice(0, 10);
  const spent = env({ KV: fakeKV({ [`scans:${today}`]: '100' }) });
  check('the daily quota returns 429 once spent',
    (await worker.fetch(post({ image: IMAGE }), spent)).status === 429);

  await withModel(GOOD, async () => {
    const e = env();
    await worker.fetch(post({ image: IMAGE }), e);
    const counted = await e.KV.get(`scans:${today}`);
    check('a successful scan increments the counter', counted === '1', `counter=${counted}`);
  });

  await withModel(GOOD, async () => {
    // A missing KV binding is a deploy mistake; it must not block her scan.
    const res = await worker.fetch(post({ image: IMAGE }), env({ KV: undefined }));
    check('with no KV binding the scan still works, cap simply off', res.status === 200, `status ${res.status}`);
  });

  /* -------------------------------------------- the model response validator */

  await withModel(GOOD, async () => {
    const res = await worker.fetch(post({ image: IMAGE }), env());
    const body = await res.json();
    check('a good reply comes back as dishes', res.status === 200 && body.dishes.length === 2);
    check('and carries the allowed origin', res.headers.get('access-control-allow-origin') === ORIGIN);
  });

  await withModel('```json\n' + GOOD + '\n```', async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('a fenced reply is unwrapped', Array.isArray(body.dishes) && body.dishes.length === 2);
  });

  await withModel('Here is the menu you asked for: ' + GOOD + ' Hope that helps!', async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('chatty prose around the JSON is trimmed', Array.isArray(body.dishes) && body.dishes.length === 2);
  });

  await withModel('{"dishes":[{"dish":"Mystery pie","tier":"probably fine","why":"Looks alright."}]}', async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('an invented tier becomes unsure, never green',
      body.dishes && body.dishes[0].tier === 'unsure', JSON.stringify(body.dishes && body.dishes[0]));
  });

  await withModel(JSON.stringify({
    dishes: Array.from({ length: 80 }, (_, i) => ({ dish: `Dish ${i}`, tier: 'green', why: 'ok' })),
  }), async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('the dish list is capped at 40', body.dishes.length === 40, `${body.dishes.length} dishes`);
  });

  await withModel(JSON.stringify({
    dishes: [{ dish: 'Long one', tier: 'red', why: 'w'.repeat(500), makeItGreen: 'm'.repeat(500) }],
  }), async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('over-long why and makeItGreen are truncated',
      body.dishes[0].why.length <= 160 && body.dishes[0].makeItGreen.length <= 160,
      `why=${body.dishes[0].why.length} fix=${body.dishes[0].makeItGreen.length}`);
  });

  for (const [label, reply] of [
    ['outright non-JSON', 'the model had a bad day'],
    ['the unreadable sentinel', '{"error":"unreadable"}'],
    ['an empty dish list', '{"dishes":[]}'],
    ['dishes as the wrong type', '{"dishes":"lots"}'],
    ['entries with no dish name', '{"dishes":[{"tier":"green","why":"x"}]}'],
  ]) {
    await withModel(reply, async () => {
      const res = await worker.fetch(post({ image: IMAGE }), env());
      const body = await res.json();
      check(`${label} becomes a kind unreadable error`,
        res.status >= 400 && body.error === 'unreadable', `status ${res.status} ${JSON.stringify(body)}`);
    });
  }

  await withModel('{}', async () => {
    const e = env();
    await worker.fetch(post({ image: IMAGE }), e);
    const counted = await e.KV.get(`scans:${today}`);
    check('a failed scan does not burn quota', counted === null || counted === '0', `counter=${counted}`);
  });

  /* ---------------------------------------------------------------- report */

  console.log(`\n${passed}/${passed + failures.length} Worker checks passed`);
  if (failures.length) {
    console.log('failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
})().catch((error) => {
  console.error('harness error:', error);
  process.exit(2);
});
