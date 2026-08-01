// Bump Appetit menu scanner, Path B.
//
// The static site cannot hold a model API key, so this Worker holds it instead.
// It takes a base64 JPEG, asks a vision model to classify each dish against
// Australian pregnancy guidelines, validates the answer hard, and hands back
// JSON the app can trust. Everything it refuses to do is on purpose:
//
// - no wildcard CORS, ever (the allowed origin comes from an env var)
// - no request without the shared passphrase
// - no more than DAILY_LIMIT model calls a day, counted in KV
// - no malformed model output reaching the app: bad JSON becomes "unreadable"
//
// Secrets: PASS and MODEL_KEY. See wrangler.toml for where to set them.

const DAILY_LIMIT = 100;

// Base64 grows a JPEG by about a third, so this is roughly a 6MB photo. The app
// resizes to 1280px long edge before upload, which lands well under it.
const MAX_IMAGE_CHARS = 8_000_000;

const MAX_DISHES = 40;
const MAX_WHY = 160;
const MAX_DISH_NAME = 120;

const VALID_TIERS = new Set(['green', 'yellow', 'red', 'unsure']);

// KV keys expire after two days, so a day's counter cleans itself up.
const COUNTER_TTL_S = 172800;

const MODEL_TIMEOUT_MS = 45000;

// Build spec 9.3, verbatim. Iterate against real menus before touching it.
const SYSTEM_PROMPT = `You are a pregnancy food-safety checker for an Australian user, applying Australian
guidelines (Royal Women's Hospital 2026, NSW Food Authority, FSANZ).

INPUT: a photo of a menu. TASK: identify each distinct dish or drink and classify it.

TIERS:
- "red": avoid in pregnancy (raw/undercooked egg incl. hollandaise/aioli/house mayo,
  runny yolks; cold deli meats; refrigerated pate; soft or semi-soft cheese unless the
  dish is cooked and served hot; raw or smoked seafood; pre-cooked cold prawns;
  store-bought sushi or raw-fish sushi; soft serve or machine ice cream; raw sprouts;
  hummus/tahini; rockmelon; alcohol; energy drinks; kombucha/kefir/ginger beer;
  pre-made refrigerated salads; raw enoki).
- "yellow": fine with a limit (caffeinated drinks: 200mg/day; high-mercury fish:
  shark/flake, swordfish, marlin, broadbill once a fortnight; orange roughy, catfish
  once a week; liver 50g/week).
- "green": freshly cooked, served hot, or otherwise safe.
- "unsure": you cannot tell from the menu (unknown sauces, unclear preparation).

RULES:
1. Prefer "unsure" over guessing. Never mark a dish green if any ingredient is unclear.
2. A dish's tier = its worst ingredient. Note the ingredient in "why".
3. "why" must be one short sentence naming the trigger, e.g. "Hollandaise is a raw-egg sauce."
4. When a simple modification fixes it, add "makeItGreen", e.g. "Ask for firm-cooked eggs, no hollandaise."
5. Only list items actually on the menu. Never invent dishes.
6. If the image is not a readable menu, return {"error":"unreadable"}.

OUTPUT: JSON only, no markdown, exactly:
{"dishes":[{"dish":"","tier":"green|yellow|red|unsure","why":"","makeItGreen":""}]}`;

/* -------------------------------------------------------------------- CORS */

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGIN) || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Default deny. With ALLOWED_ORIGIN unset no browser origin is echoed back, so
 * a misconfigured deploy fails closed instead of opening the Worker to the web.
 * A request with no Origin header (curl, a health check) is not a browser and
 * is left to the passphrase check.
 */
function originAllowed(env, origin) {
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

function corsHeaders(env, origin) {
  const headers = { 'Vary': 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * The browser preflights every POST that carries x-bump-pass, so this has to
 * be a real responder, not an afterthought.
 */
function preflight(env, req, origin) {
  if (!originAllowed(env, origin)) {
    return new Response(null, { status: 403 });
  }
  const requested = req.headers.get('Access-Control-Request-Headers');
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(env, origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': requested || 'content-type, x-bump-pass',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/* ------------------------------------------------------------------ guards */

/** Length-first, then a full sweep, so a wrong pass cannot be timed out of us. */
function sameSecret(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function todayKey() {
  return `scans:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * KV reads are eventually consistent, so two scans landing in the same second
 * can both see the same count. That is fine: this is a quota guard against a
 * stranger with the URL, not a billing ledger.
 */
async function readCount(env) {
  if (!env || !env.KV) return null;   // no binding, no counter: see the note below
  try {
    return parseInt((await env.KV.get(todayKey())) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

async function bumpCount(env, used) {
  if (!env || !env.KV) return;
  try {
    await env.KV.put(todayKey(), String(used + 1), { expirationTtl: COUNTER_TTL_S });
  } catch {
    // A failed write costs one uncounted scan. Failing the whole request over
    // it would cost her the answer, which is the worse trade.
  }
}

/* ------------------------------------------------------------ model client */

/**
 * Gemini first: the free tier is the reason this app costs nothing to run.
 * Everything model-shaped lives in this one function, so swapping providers is
 * a change here and nowhere else. The Claude alternative is directly below.
 */
async function callVisionModel(env, prompt, image) {
  const model = String((env && env.MODEL) || 'gemini-2.0-flash');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': String(env.MODEL_KEY || ''),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{
        role: 'user',
        parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }],
      }],
      generationConfig: {
        // Zero, because a food-safety verdict is not a place for flair.
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) return '';

  const body = await res.json();
  const parts = (body
    && Array.isArray(body.candidates)
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts) || [];

  return parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
}

// Claude Messages API alternative. Swap the body of callVisionModel for this
// and set MODEL_KEY to an Anthropic key. Same inputs, same string out.
//
// const res = await fetch('https://api.anthropic.com/v1/messages', {
//   method: 'POST',
//   headers: {
//     'content-type': 'application/json',
//     'x-api-key': String(env.MODEL_KEY || ''),
//     'anthropic-version': '2023-06-01',
//   },
//   body: JSON.stringify({
//     model: String(env.MODEL || 'claude-haiku-4-5'),
//     max_tokens: 2048,
//     temperature: 0,
//     system: prompt,
//     messages: [{
//       role: 'user',
//       content: [
//         { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
//         { type: 'text', text: 'Classify this menu.' },
//       ],
//     }],
//   }),
//   signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
// });
// if (!res.ok) return '';
// const body = await res.json();
// return (body.content || []).map((part) => (part.type === 'text' ? part.text : '')).join('');

/* ---------------------------------------------------------------- parsing */

function tidy(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Models like to wrap JSON in a code fence even when told not to, so the fence
 * is stripped rather than treated as a failure. Everything past that is
 * validated: a malformed answer becomes "unreadable" and the app shows its
 * kind retake screen.
 */
function safeParseVerdicts(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  }

  // Any prose the model added around the object gets trimmed off the ends.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  // The prompt tells the model to say so when the photo is not a menu.
  if (typeof parsed.error === 'string') return null;
  if (!Array.isArray(parsed.dishes)) return null;

  const dishes = [];
  for (const entry of parsed.dishes) {
    if (!entry || typeof entry !== 'object') continue;
    const dish = tidy(entry.dish, MAX_DISH_NAME);
    if (!dish) continue;

    const tier = String(entry.tier || '').toLowerCase().trim();
    // An invented tier is never promoted to safe: unsure is the honest bucket.
    const safeTier = VALID_TIERS.has(tier) ? tier : 'unsure';

    dishes.push({
      dish,
      tier: safeTier,
      why: tidy(entry.why, MAX_WHY),
      makeItGreen: tidy(entry.makeItGreen, MAX_WHY),
    });

    if (dishes.length >= MAX_DISHES) break;
  }

  // An empty menu is not a result, it is a photo that did not work.
  if (!dishes.length) return null;
  return { dishes };
}

/* -------------------------------------------------------------------- main */

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (req.method === 'OPTIONS') return preflight(env, req, origin);

    if (!originAllowed(env, origin)) {
      return json({ error: 'forbidden' }, 403, cors);
    }

    if (req.method !== 'POST') {
      return json({ error: 'method' }, 405, { ...cors, 'Allow': 'POST, OPTIONS' });
    }

    // Fails closed: with no PASS secret set, nothing gets through.
    if (!env || !env.PASS || !sameSecret(req.headers.get('x-bump-pass'), env.PASS)) {
      return json({ error: 'bad-pass' }, 401, cors);
    }

    if (!env.MODEL_KEY) {
      return json({ error: 'unreadable' }, 503, cors);
    }

    // null means there is no KV binding at all. The scan still runs, because a
    // missing binding is a deploy mistake and blocking her is not the fix, but
    // the daily guard is off until it is bound. See wrangler.toml.
    const used = await readCount(env);
    if (used !== null && used >= DAILY_LIMIT) {
      return json({ error: 'daily-limit' }, 429, cors);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad-image' }, 400, cors);
    }

    let image = body && typeof body.image === 'string' ? body.image : '';
    // The app sends bare base64, but a data URL prefix is a cheap thing to survive.
    const comma = image.indexOf(',');
    if (image.startsWith('data:') && comma > 0) image = image.slice(comma + 1);

    if (!image || image.length > MAX_IMAGE_CHARS) {
      return json({ error: 'bad-image' }, 400, cors);
    }

    let raw = '';
    try {
      raw = await callVisionModel(env, SYSTEM_PROMPT, image);
    } catch {
      // A timeout or a provider outage. The app says so kindly and offers the
      // on-device fallback, so there is nothing useful to leak here.
      return json({ error: 'unreadable' }, 502, cors);
    }

    const parsed = safeParseVerdicts(raw);
    if (!parsed) return json({ error: 'unreadable' }, 502, cors);

    // Counted only once a scan actually worked, so a bad photo never costs her
    // a slot in the daily quota.
    if (used !== null) await bumpCount(env, used);

    return json(parsed, 200, cors);
  },
};
