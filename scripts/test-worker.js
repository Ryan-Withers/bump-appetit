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

/** Wraps a reply string in whichever provider's response envelope. */
function envelope(provider, replyText) {
  return provider === 'gemini'
    ? { candidates: [{ content: { parts: [{ text: replyText }] } }] }
    : { content: [{ type: 'text', text: replyText }] };
}

/**
 * Swaps global fetch for one that returns a canned reply in the given
 * provider's shape, and records what the Worker actually sent. Anthropic is the
 * default because that is what an unconfigured deploy now uses.
 */
function withModel(replyText, fn, { status = 200, provider = 'anthropic' } = {}) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify(envelope(provider, replyText)), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return fn(sent).finally(() => { globalThis.fetch = real; });
}

const GOOD = JSON.stringify({
  dishes: [
    { dish: 'Eggs Benedict', tier: 'red', why: 'Hollandaise is a raw-egg sauce.', makeItGreen: 'Ask for firm eggs, no hollandaise.' },
    { dish: 'Grilled barramundi', tier: 'green', why: 'Cooked through and served hot.', makeItGreen: '' },
  ],
});

const IMAGE = 'x'.repeat(2000);

/**
 * The image blocks out of a captured request, whichever provider shape it is.
 * Views arrive labelled, so the pictures are no longer at a fixed index and
 * asking for content[0] would only be testing the label.
 */
function imageBlocks(call) {
  const body = JSON.parse(call.init.body);
  if (body.contents) {
    return (body.contents[0].parts || [])
      .filter((part) => part && part.inline_data)
      .map((part) => ({ source: { data: part.inline_data.data, media_type: part.inline_data.mime_type } }));
  }
  return (body.messages[0].content || []).filter((block) => block && block.type === 'image');
}

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

  /* ------------------------------------------------------ the model request */

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post({ image: IMAGE }), env());
    const call = sent[0] || {};
    const headers = call.init.headers || {};
    const body = JSON.parse(call.init.body || '{}');

    check('by default the Worker calls Anthropic',
      call.url === 'https://api.anthropic.com/v1/messages', call.url);
    check('with the key in x-api-key and a pinned api version',
      headers['x-api-key'] === 'fake-key' && headers['anthropic-version'] === '2023-06-01',
      JSON.stringify(headers));
    check('the model is Haiku 4.5', body.model === 'claude-haiku-4-5', body.model);
    check('temperature is zero, because a verdict is not a place for flair',
      body.temperature === 0, String(body.temperature));
    check('the build-spec system prompt is sent as the system prompt',
      typeof body.system === 'string' && body.system.includes('pregnancy food-safety checker'));

    // Both of these are rejected outright by Haiku 4.5, so a stray one would
    // turn every scan into a 400 that only shows up in production.
    check('no effort or thinking field is sent',
      body.effort === undefined && body.thinking === undefined,
      JSON.stringify({ effort: body.effort, thinking: body.thinking }));

    const content = (body.messages && body.messages[0] && body.messages[0].content) || [];
    check('the photo is sent as a base64 block',
      content[1] && content[1].type === 'image'
      && content[1].source.type === 'base64'
      && content[1].source.media_type === 'image/jpeg'
      && content[1].source.data === IMAGE,
      JSON.stringify(content[1] && content[1].source && content[1].source.type));
    // Each picture is introduced, so several views of one menu cannot read as
    // several different menus and duplicate every dish.
    check('each view is labelled before its picture',
      content[0] && content[0].type === 'text' && /view 1/i.test(content[0].text),
      content[0] && content[0].text);
    check('and the instruction comes last',
      content[content.length - 1].type === 'text'
      && /json only/i.test(content[content.length - 1].text),
      content[content.length - 1].text);
  });

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post({ image: IMAGE }), env({ MODEL: 'claude-sonnet-5' }));
    check('the MODEL variable overrides the model id',
      JSON.parse(sent[0].init.body).model === 'claude-sonnet-5');
  });

  /* ------------------------------------------------ the provider is swappable */

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: IMAGE }), env({ MODEL_PROVIDER: 'gemini', MODEL: 'gemini-2.0-flash' }));
    check('MODEL_PROVIDER=gemini switches provider',
      /generativelanguage\.googleapis\.com/.test(sent[0].url), sent[0].url);
    check('and sends the key the Google way',
      (sent[0].init.headers || {})['x-goog-api-key'] === 'fake-key');
    check('and its reply shape still parses', res.status === 200, `status ${res.status}`);
  }, { provider: 'gemini' });

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post({ image: IMAGE }), env({ MODEL: 'gemini-2.0-flash' }));
    check('a gemini model id alone is enough to pick the Google path',
      /generativelanguage/.test(sent[0].url), sent[0].url);
  }, { provider: 'gemini' });

  /* ------------------------------------------------------------ the picture */

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: `data:image/png;base64,${IMAGE}` }), env());
    const source = imageBlocks(sent[0])[0].source;
    check('a data URL prefix is stripped off', source.data === IMAGE, source.data.slice(0, 24));
    check('and its declared media type is carried through, not assumed JPEG',
      source.media_type === 'image/png', source.media_type);
    check('the scan still succeeds', res.status === 200);
  });

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: 'not base64 at all !!! <script>' }), env());
    check('junk in the image field is refused before the model is called',
      res.status === 400 && sent.length === 0, `status ${res.status}, ${sent.length} calls`);
  });

  /* ------------------------------------------------- the menu that was too big */

  // The real-world failure this was written for: a 50-dish bistro menu whose
  // reply ran past the token budget and stopped mid-object. Before, the parse
  // threw and a perfectly sharp photo came back "unreadable". Now the complete
  // dishes are kept and the answer admits it is short.
  const TRUNCATED = '{"dishes":['
    + Array.from({ length: 12 }, (_, i) =>
      `{"dish":"Dish ${i}","tier":"green","why":"Cooked through.","makeItGreen":""}`).join(',')
    + ',{"dish":"Half writ';

  await withModel(TRUNCATED, async () => {
    const res = await worker.fetch(post({ image: IMAGE }), env());
    const body = await res.json();
    check('a reply cut off mid-dish still yields the dishes that survived',
      res.status === 200 && body.dishes.length === 12, `status ${res.status}, ${(body.dishes || []).length} dishes`);
    check('the half-written dish at the cut is dropped, not half-shown',
      (body.dishes || []).every((d) => d.dish !== 'Half writ'), JSON.stringify((body.dishes || []).slice(-1)));
    check('and the answer says it is partial, so a short list is never mistaken for the menu',
      body.partial === true, JSON.stringify(body.partial));
  });

  await withModel(GOOD, async () => {
    const body = await (await worker.fetch(post({ image: IMAGE }), env())).json();
    check('a complete reply is never flagged partial', body.partial === undefined, JSON.stringify(body.partial));
  });

  await withModel('{"dishes":[{"dish":"Only half writ', async () => {
    const res = await worker.fetch(post({ image: IMAGE }), env());
    check('a reply with no whole dish in it is still unreadable, not empty success',
      res.status === 502, `status ${res.status}`);
  });

  /* ------------------------------------------------------- the extra views */

  // A big menu is sent as the whole frame plus overlapping halves, so the
  // description lines arrive readable. All of it has to ride in ONE call: the
  // daily limit counts calls, and three calls per scan would cut her budget by
  // two thirds without telling her.
  const TILES = ['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000)];

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: TILES[0], images: TILES }), env());
    check('every view reaches the model', imageBlocks(sent[0]).length === 3,
      `${imageBlocks(sent[0]).length} images`);
    check('and they all go in a single call, so one scan is still one call',
      sent.length === 1, `${sent.length} calls`);
    check('the whole frame leads, with the close-ups after it',
      imageBlocks(sent[0]).map((b) => b.source.data[0]).join('') === 'abc',
      imageBlocks(sent[0]).map((b) => b.source.data[0]).join(''));
    check('the scan succeeds with views', res.status === 200);
  });

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post({ image: TILES[0], images: TILES }), env({ MODEL: 'gemini-2.0-flash' }));
    check('the Google path carries every view too', imageBlocks(sent[0]).length === 3,
      `${imageBlocks(sent[0]).length} images`);
  });

  await withModel(GOOD, async (sent) => {
    await worker.fetch(post({ image: TILES[0], images: TILES.concat(TILES) }), env());
    check('more views than the cap are trimmed rather than paid for',
      imageBlocks(sent[0]).length === 3, `${imageBlocks(sent[0]).length} images`);
  });

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: TILES[0], images: [TILES[0], 'junk !!!'] }), env());
    check('one bad view fails the scan rather than quietly reading half the menu',
      res.status === 400 && sent.length === 0, `status ${res.status}, ${sent.length} calls`);
  });

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: IMAGE }), env());
    check('a client that sends no views still works, so rollout order is free',
      res.status === 200 && imageBlocks(sent[0]).length === 1,
      `status ${res.status}, ${imageBlocks(sent[0]).length} images`);
  });

  // The invariant that matters: nothing outside the allowlist ever reaches the
  // model, under any label. An iPhone HEIC relabelled image/jpeg is a billed
  // call that can only come back unreadable, so it must die here as a free 400.
  for (const declared of ['image/heic', 'image/heif', 'IMAGE/HEIC', 'image/heic;charset=utf-8', 'image/avif', 'image/bmp', 'image/tiff', 'application/pdf']) {
    await withModel(GOOD, async (sent) => {
      const res = await worker.fetch(post({ image: `data:${declared};base64,${IMAGE}` }), env());
      check(`a ${declared} data URL is a free 400, never a model call`,
        res.status === 400 && sent.length === 0, `status ${res.status}, ${sent.length} calls`);
    });
  }

  for (const [declared, expected] of [
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],     // sloppy but honest labels stay working
    ['image/pjpeg', 'image/jpeg'],
    ['IMAGE/PNG', 'image/png'],
    ['image/gif', 'image/gif'],
    ['image/webp', 'image/webp'],
  ]) {
    await withModel(GOOD, async (sent) => {
      const res = await worker.fetch(post({ image: `data:${declared};base64,${IMAGE}` }), env());
      const source = imageBlocks(sent[0])[0].source;
      check(`${declared} goes through as ${expected}`,
        res.status === 200 && source.media_type === expected, `status ${res.status} type=${source && source.media_type}`);
    });
  }

  await withModel(GOOD, async (sent) => {
    const res = await worker.fetch(post({ image: 'data:image/jpeg;base64' }), env());
    check('a data URL with no comma is refused, not sliced into nonsense',
      res.status === 400 && sent.length === 0, `status ${res.status}, ${sent.length} calls`);
  });

  await withModel(GOOD, async () => {
    const res = await worker.fetch(post({ image: 'z'.repeat(7_999_999) }), env());
    check('an image just under the size cap still goes through', res.status === 200, `status ${res.status}`);
  });

  /* ------------------------------------------------- when the provider is down */

  {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      await withModel('{"error":{"message":"invalid x-api-key"}}', async () => {
        const res = await worker.fetch(post({ image: IMAGE }), env());
        check('a rejected key becomes a kind unreadable, not a stack trace',
          res.status === 502 && (await res.json()).error === 'unreadable', `status ${res.status}`);
      }, { status: 401 });
    } finally {
      console.warn = realWarn;
    }
    check('the failure is logged so it can be diagnosed',
      warnings.some((line) => /401/.test(line)), JSON.stringify(warnings));
    check('and the log never contains the key',
      !warnings.some((line) => line.includes('fake-key')), JSON.stringify(warnings));
  }

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
    check('the dish list is capped at 60, which covers a full pub menu',
      body.dishes.length === 60, `${body.dishes.length} dishes`);
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

  /* ------------------------------------------- what the quota actually counts */

  // This suite used to assert the opposite, and was wrong: it treated the cap
  // as a count of good answers when the thing worth capping is money. A scan
  // that came back unreadable was billed exactly like one that worked, so
  // counting only successes left an unbounded hole for anyone holding the
  // passphrase, which ships to the browser and is therefore public.
  await withModel('{}', async () => {
    const e = env();
    const res = await worker.fetch(post({ image: IMAGE }), e);
    const counted = await e.KV.get(`scans:${today}`);
    check('a scan that fails validation still counts, because it still cost money',
      res.status === 502 && counted === '1', `status ${res.status} counter=${counted}`);
  });

  await withModel('{"error":"unreadable"}', async () => {
    // The exact loop a stranger would run: a photo of anything that is not a
    // menu, over and over. The model obeys rule 6 every time.
    const e = env();
    for (let i = 0; i < 5; i += 1) await worker.fetch(post({ image: IMAGE }), e);
    check('a loop of non-menu photos burns the quota rather than running free',
      (await e.KV.get(`scans:${today}`)) === '5', `counter=${await e.KV.get(`scans:${today}`)}`);
  });

  await withModel(GOOD, async (sent) => {
    const e = env({ KV: fakeKV({ [`scans:${today}`]: '100' }) });
    const res = await worker.fetch(post({ image: IMAGE }), e);
    check('and once spent, the cap is reached before the model is called, not after',
      res.status === 429 && sent.length === 0, `status ${res.status}, ${sent.length} model calls`);
  });

  /* ------------------------------------------------ when KV itself misbehaves */

  await withModel(GOOD, async () => {
    // A read that throws must not be read as "zero scans today": writing 1 over
    // a real count of 87 would hand back 86 slots, and over 100 would un-spend
    // a cap that had correctly stopped.
    const broken = fakeKV({ [`scans:${today}`]: '87' });
    broken.get = async () => { throw new Error('KV blip'); };
    const e = env({ KV: broken });
    const res = await worker.fetch(post({ image: IMAGE }), e);
    check('a failed KV read never clobbers the real count',
      res.status === 200 && broken.store.get(`scans:${today}`) === '87',
      `status ${res.status} counter=${broken.store.get(`scans:${today}`)}`);
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
