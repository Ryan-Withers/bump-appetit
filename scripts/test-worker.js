#!/usr/bin/env node
// Exercises the Worker against a fake model and a fake KV.
//
// Two things are being defended here. First, that nothing the model says
// reaches a frightened parent unchecked: an invented phone number, a citation
// of a note that was never supplied, or malformed JSON must all collapse to a
// refusal rather than be shown. Second, that two phones ticking things offline
// both survive the merge.
//
// Run: node scripts/test-worker.js

import worker from '../worker/ask-worker.js';

const ORIGIN = 'https://ryan-withers.github.io';
const PASS = 'test-pass';

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed += 1; else failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  :: ${detail}` : ''}`);
}

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? String(store.get(k)) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

function env(over = {}) {
  return { PASS, MODEL_KEY: 'fake', ALLOWED_ORIGIN: ORIGIN, KV: fakeKV(), ...over };
}

function post(path, body, { origin = ORIGIN, pass = PASS, method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (pass !== null) headers['x-bub-pass'] = pass;
  return new Request(`https://bub.example.workers.dev${path}`, {
    method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function withModel(reply, fn, { status = 200 } = {}) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: reply }] }),
      { status, headers: { 'content-type': 'application/json' } });
  };
  return fn(sent).finally(() => { globalThis.fetch = real; });
}

const NOTES = [
  { id: 'green-poo', name: 'Green poo', tier: 'normal', why: 'Common and usually nothing.' },
  { id: 'fewer-wet-nappies', name: 'Fewer wet nappies', tier: 'call', why: 'Can mean not enough milk.', whoToCall: 'GP' },
];
const GOOD = JSON.stringify({
  answer: 'Green nappies are common and usually nothing to worry about.',
  used: ['green-poo'], ring: null, grounded: true,
});

(async () => {
  /* ------------------------------------------------------------ the door */

  const pre = await worker.fetch(post('/ask', null, { method: 'OPTIONS' }), env());
  check('preflight is answered', pre.status === 204 || pre.status === 200, `status ${pre.status}`);

  const evil = await worker.fetch(post('/ask', { question: 'hi' }, { origin: 'https://evil.example' }), env());
  check('a foreign origin is refused', evil.status === 403);
  check('and is never echoed back', evil.headers.get('access-control-allow-origin') !== 'https://evil.example');

  check('no passphrase is rejected',
    (await worker.fetch(post('/ask', { question: 'hi' }, { pass: null }), env())).status === 401);
  check('a wrong passphrase is rejected',
    (await worker.fetch(post('/ask', { question: 'hi' }, { pass: 'nope' }), env())).status === 401);
  check('an unknown path is a 404, not a model call',
    (await worker.fetch(post('/nope', { question: 'hi' }), env())).status === 404);

  /* --------------------------------------------------------------- asking */

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post('/ask', { question: 'is green poo ok', notes: NOTES }), env());
    const body = await res.json();
    check('a grounded answer comes back', res.status === 200 && body.grounded === true, JSON.stringify(body));
    check('and names the note it used', body.used.join() === 'green-poo', body.used.join());
    check('the model was actually called', sent.length === 1);
  });

  await withModel(GOOD, async (sent) => {
    const body = JSON.parse(sent.length ? '{}' : '{}');
    const res = await worker.fetch(post('/ask', { question: 'what about tax law', notes: [] }), env());
    const out = await res.json();
    check('no matching notes means no model call at all',
      res.status === 200 && out.grounded === false && sent.length === 0,
      `status ${res.status}, ${sent.length} calls`);
    check('and it hands back a phone number instead', out.ring === 'Nurse line', out.ring);
  });

  // The invention cases: the whole reason the response is parsed rather than passed through.
  await withModel(JSON.stringify({
    answer: 'Give 2.5ml of the usual stuff.', used: ['made-up-note'], ring: null, grounded: true,
  }), async () => {
    const body = await (await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), env())).json();
    check('a cited note that was never supplied is dropped', body.used.length === 0, JSON.stringify(body.used));
    check('and the answer is no longer called grounded', body.grounded === false);
  });

  await withModel(JSON.stringify({
    answer: 'Ring the baby hotline.', used: ['green-poo'], ring: 'Baby Hotline 1800 FAKE', grounded: true,
  }), async () => {
    const body = await (await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), env())).json();
    check('an invented service to ring is dropped rather than shown', body.ring === null, String(body.ring));
  });

  await withModel('not json at all, sorry', async () => {
    const res = await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), env());
    check('a malformed answer is a refusal, never a guess', res.status === 502, `status ${res.status}`);
  });

  await withModel(JSON.stringify({ answer: '', used: [], ring: null, grounded: true }), async () => {
    const res = await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), env());
    check('an empty answer is refused too', res.status === 502);
  });

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), env());
    const sentBody = JSON.parse(sent[0].init.body);
    check('the notes are the only source material in the prompt',
      sentBody.messages[0].content.includes('green-poo')
      && sentBody.messages[0].content.includes('THE NOTES YOU MAY USE'));
    check('temperature is zero', sentBody.temperature === 0);
    check('the system prompt forbids doses',
      /never give a medication dose/i.test(sentBody.system), 'missing dose rule');
    check('and carries the ring-000 override',
      /START\s*\n?\s*with the instruction to ring 000|ring 000/i.test(sentBody.system));
  });

  /* ---------------------------------------------------------------- quota */

  const today = `asks:${new Date().toISOString().slice(0, 10)}`;
  await withModel(GOOD, async (sent) => {
    const spent = env({ KV: fakeKV({ [today]: '120' }) });
    const res = await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), spent);
    check('the daily cap returns 429 before the model is called',
      res.status === 429 && sent.length === 0, `status ${res.status}, ${sent.length} calls`);
  });

  await withModel(GOOD, async () => {
    const e = env();
    await worker.fetch(post('/ask', { question: 'q', notes: NOTES }), e);
    check('a successful ask counts against the day', (await e.KV.get(today)) === '1');
  });

  /* ----------------------------------------------------------------- sync */

  const hh = { household: 'withers-house' };

  {
    const e = env();
    const first = await (await worker.fetch(post('/sync', {
      ...hh, changes: { 'buy:pram': { v: true, at: 1000, by: 'Ryan' } },
    }), e)).json();
    check('a change is stored and acknowledged',
      first.state['buy:pram'].v === true && first.acked.includes('buy:pram'), JSON.stringify(first));

    // The other phone, offline, ticked something else. Both must survive.
    const second = await (await worker.fetch(post('/sync', {
      ...hh, changes: { 'buy:bassinet': { v: true, at: 1100, by: 'Emma' } },
    }), e)).json();
    check('the other phone\'s change does not wipe the first',
      second.state['buy:pram'] && second.state['buy:bassinet'], Object.keys(second.state).join());

    // A stale write, arriving late from a phone that was offline.
    const stale = await (await worker.fetch(post('/sync', {
      ...hh, changes: { 'buy:pram': { v: false, at: 900, by: 'Ryan' } },
    }), e)).json();
    check('an older write never overwrites a newer one',
      stale.state['buy:pram'].v === true, JSON.stringify(stale.state['buy:pram']));
    check('but it is still acknowledged, so it leaves the outbox',
      stale.acked.includes('buy:pram'));

    const newer = await (await worker.fetch(post('/sync', {
      ...hh, changes: { 'buy:pram': { v: false, at: 2000, by: 'Emma' } },
    }), e)).json();
    check('a newer write does win', newer.state['buy:pram'].v === false);
    check('and the merge records who did it', newer.state['buy:pram'].by === 'Emma');
  }

  check('a nonsense household code is refused',
    (await worker.fetch(post('/sync', { household: 'no', changes: {} }), env())).status === 400);
  check('sync without a KV binding fails loudly rather than pretending',
    (await worker.fetch(post('/sync', hh), env({ KV: undefined }))).status === 503);

  console.log('');
  if (failures.length) {
    console.log(`Worker failed: ${failures.length} problem${failures.length > 1 ? 's' : ''}.`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`${passed}/${passed} Worker checks passed.`);
})();
