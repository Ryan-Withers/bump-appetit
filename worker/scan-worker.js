// Bump Appetit menu scanner, Path B.
//
// The static site cannot hold a model API key, so this Worker holds it instead.
// It takes a base64 JPEG, asks a vision model to classify each dish against
// Australian pregnancy guidelines, validates the answer hard, and hands back
// JSON the app can trust. Everything it refuses to do is on purpose:
//
// - no wildcard CORS, ever (the allowed origin comes from an env var)
// - no request without the shared passphrase
// - no more than DAILY_LIMIT model calls a day, counted in KV before the call
//   is made, because what is being capped is spend and a failed call still bills
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

// The four both providers accept. The app only ever sends JPEG, but a data URL
// from a share sheet or a paste can arrive as anything, and anything else is
// refused outright rather than relabelled: a HEIC dressed up as image/jpeg is
// a billed model call that can only end in "unreadable".
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Sloppy-but-honest JPEG labels that mean image/jpeg and should keep working.
const IMAGE_TYPE_ALIASES = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg' };

// KV keys expire after two days, so a day's counter cleans itself up.
const COUNTER_TTL_S = 172800;

// Deliberately under CONFIG.scanner.timeoutMs on the client. If the model is
// having a slow day we want to answer with a clean "unreadable" she can act on,
// rather than let the phone give up first while this keeps burning the call.
const MODEL_TIMEOUT_MS = 25000;

// Rebuilt after the first live scan: the build-spec 9.3 prompt was a closed
// list matcher that defaulted unknown foods to green. This one makes unsure
// the default, requires printed evidence for green, and pins the tiers where
// data/foods.json is deliberately more relaxed than a model would guess.
// Drafted three ways, judged from three lenses, red-teamed with 80+ menu
// lines, hardened, then re-verified: 55 lines walked, zero unsafe.
// The smoke test (scripts/smoke-scan.js) is the regression gate: run it
// from the Actions tab after ANY change here.
const SYSTEM_PROMPT = `You are a pregnancy food-safety checker for an Australian user, applying Australian
guidelines (Royal Women's Hospital 2026, NSW Food Authority, FSANZ).

INPUT: a photo of a menu. TASK: identify each distinct dish or drink and classify it.

HOW TO JUDGE:
- Judge the classic Australian build of the dish, including parts the menu does not
  print: caesar dressing and tiramisu mean raw egg, slaw means mayo dressing, a bistro
  parfait means liver. Leaving the risky part unprinted does not remove it.
- A detail counts only if the menu prints it. Never supply a favourable detail
  yourself: "poached" is not firm, "cooked to your liking" is not well done, "made
  fresh daily" is not made to order, "smoked" and "cured" mean flavour, not heat, and
  "house made" confirms a raw-egg classic, it does not excuse it.
- Heat belongs to ingredients, not dishes. A dish being cooked clears only the
  ingredients that went through the heat with it. Ham, salami, pepperoni and cheese
  are baked onto a pizza: cleared. Prosciutto, smoked salmon and burrata are draped
  on after the oven: never heated, still red. A burger being cooked does not cook the
  egg sitting on top of it, and surface heat is not centre heat: fried or chargrilled
  does not make a yolk firm or a steak well done.
- The dish takes its worst part. Worst to best: red, yellow, unsure, green. Name the
  deciding part in "why".
- THE DEFAULT IS UNSURE. Green needs positive evidence: a printed word, or a build you
  positively recognise as safe. A dish you cannot place, or whose safety hangs on an
  unprinted detail, is unsure, never green, with the settling question in "makeItGreen".

THREE HAZARD SHAPES, each with its own proof:

1. MUST BE SERVED HOT (listeria): soft cheese (brie, camembert, feta or fetta, goat,
   blue, fresh mozzarella, burrata, ricotta), deli and cured meat (ham, prosciutto,
   salami, pastrami), smoked salmon or trout, pre-cooked prawns. Cold or unstated:
   red. Green only when the making of the dish necessarily cooks THAT ingredient
   through (the ham inside a toastie, jaffle, ham and cheese croissant or parmigiana, fetta baked through
   spanakopita, cheese melted on any pizza, oysters kilpatrick under the grill) or a
   printed heat word sits on it (grilled, chargrilled, fried, baked, roasted, toasted,
   melted, crisped, sizzling, steaming, piping hot, wood fired). Draped-on-after
   toppings stay red, as above. Hard cheeses, haloumi, cream cheese, mascarpone:
   green anywhere.

2. THE CENTRE MUST BE COOKED (egg yolk, red meat):
   - Egg with a runny word (poached, soft boiled, sunny side up, runny): red.
   - Raw-egg classics (hollandaise, bearnaise, caesar dressing, tiramisu, mousse,
     eggnog, fried ice cream), mayo or aioli printed house made, and mayo salads made
     on site (coleslaw, potato salad): red; only a printed "egg free" lifts it. Bare
     mayo, aioli, garlic sauce or tartare sauce: unsure, makeItGreen "Ask if it comes
     from a commercial bottle."
   - Egg cooked firm by the recipe itself (quiche, frittata, scrambled, omelette,
     french toast, cakes, puddings, pavlova, baked meringue): green. A fried egg or
     bare egg with no yolk state: unsure, makeItGreen "Ask for the yolk cooked firm."
   - Steak, or any beef, lamb or duck cut that can come out pink: green only if the
     menu prints well done or cooked through. Rare, medium rare, medium, blue or
     pink: red. No doneness stated, or "cooked to your liking": unsure, makeItGreen
     "Order it well done, cooked right through with no pink." A roast dinner or roast
     of the day, braise, slow cooked or pulled meat, burgers, sausages, schnitzel,
     pies, chicken and pork dishes: green, the build cooks them through.

3. TIME AND MACHINES. Being cooked once does not help if it has sat since.
   - Any cooked or smoked meat, chicken or seafood served cold, whatever the animal:
     red. A salad or cold plate counts as cold.
   - Anything pre-made and sitting (cabinet sandwiches, sushi rolls, fruit salad,
     pre-cut fruit, salad bars): red; the sitting is the hazard, not the filling.
   - Any drink or bowl blended or juiced in a cafe from fresh fruit (juice, smoothie,
     acai): red; cut fruit plus hard-to-clean blenders.
   - Soft serve, whippy, thickshakes, any machine ice cream: red, it is the machine.
     Ice cream from a tub, including the scoop beside a dessert: green. Gelato or
     sorbet from the counter: yellow, the shared scoop; makeItGreen "Ask for a fresh
     scoop from a covered tub." Milkshake: unsure, makeItGreen "Ask if it is made
     with tub ice cream, not the machine."

ALWAYS RED: raw seafood or meat (sashimi, ceviche, raw oysters, carpaccio, and
"tartare" naming the dish, like beef or tuna tartare), jerky, pate, liver parfait,
terrine, rockmelon, hummus and tahini, raw sprouts served raw, raw enoki, kombucha,
kefir, ginger beer, energy drinks, alcohol served as a drink.

YELLOW, fine with a limit, put the limit in "why":
- Anything with caffeine, cocoa included (coffee, tea, chai, cola, hot chocolate):
  200mg a day, about 1 to 2 coffees. Herbal tea, peppermint included: a couple of
  cups a day of the common flavours.
- Flake IS shark: flake, shark, swordfish, marlin, one 150g serve a fortnight; orange
  roughy or catfish, one serve a week; liver, 50g a week. The hot fry or grill is
  fine, the species sets the tier. Battered fish of unstated species: green,
  makeItGreen "Ask at the counter if the fish is flake."
- Any drink labelled zero or low alcohol: can still legally hold up to 0.5%.
- Bean sprouts tossed raw onto a hot dish (pad thai, laksa, banh mi): yellow,
  makeItGreen "Ask for no bean sprouts, or sprouts cooked right through."

WATCH:
- Wine or beer cooked into a batter, braise, pie or sauce is not a drinking hazard.
- "Tartare" as a sauce beside cooked fish is the mayo question above, not raw meat.
- "Parmigiana" or "parmy" comes out of the oven hot: green. "Parma ham" is
  prosciutto. A yoghurt and granola parfait is fine; the liver kind is red.
- Sushi: green only when rolled fresh to order with cooked fillings; a menu rarely
  proves that, so cabinet rolls or unstated: red.

RULES:
1. Never award green on a detail you supplied. Positive evidence is a printed word or
   the dish's own cooked-by-nature build; if your "why" needs anything else, like an
   unprinted "firm", "well done" or "pasteurised", the dish is at best unsure.
2. "why" is one short kind sentence naming the deciding part, e.g. "Hollandaise is a
   raw-egg sauce."
3. Fill "makeItGreen" with the simple fix or settling question when one exists,
   otherwise "".
4. Only list items actually on the menu. Never invent dishes.
5. If the image is not a readable menu, return {"error":"unreadable"}.

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
    // null, not 0. Reading 0 from a failed read would let the next scan write
    // "1" over a real count of 87 and hand back 86 slots, or un-spend a cap
    // that had correctly stopped at 100. null means "cap off for this one
    // request, and do not write", which loses nothing and destroys nothing.
    return null;
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

const DEFAULT_MODEL = 'claude-haiku-4-5';

function modelId(env) {
  return String((env && env.MODEL) || '').trim() || DEFAULT_MODEL;
}

/**
 * Claude unless told otherwise. MODEL_PROVIDER wins when it is set, and failing
 * that a gemini-* model id picks the Google path, so changing provider is one
 * dashboard variable rather than an edit in here.
 */
function providerFor(env) {
  const named = String((env && env.MODEL_PROVIDER) || '').toLowerCase().trim();
  if (named === 'anthropic' || named === 'claude') return 'anthropic';
  if (named === 'gemini' || named === 'google') return 'gemini';
  return /^gemini/i.test(modelId(env)) ? 'gemini' : 'anthropic';
}

/**
 * Observability only. The app is never told which provider failed or why, but
 * "unreadable" with no trail behind it is impossible to diagnose, and the most
 * likely cause by far is a key that was pasted wrong.
 */
async function modelFailed(provider, res) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // Nothing to add. The status alone still says most of it.
  }
  console.warn(`scan: ${provider} answered ${res.status}`, detail);
  return '';
}

/** Anthropic Messages API. Image block first, then the instruction. */
async function callAnthropic(env, prompt, image) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(env.MODEL_KEY || ''),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId(env),
      max_tokens: 2048,
      // Zero, because a food-safety verdict is not a place for flair.
      temperature: 0,
      system: prompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
          { type: 'text', text: 'Read this menu and classify every dish. JSON only.' },
        ],
      }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) return modelFailed('anthropic', res);

  const body = await res.json();
  return (Array.isArray(body && body.content) ? body.content : [])
    .map((part) => (part && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** Google Gemini, kept live rather than commented out so it stays swappable. */
async function callGemini(env, prompt, image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId(env)}:generateContent`;

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
        parts: [{ inline_data: { mime_type: image.mediaType, data: image.data } }],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) return modelFailed('gemini', res);

  const body = await res.json();
  const parts = (body
    && Array.isArray(body.candidates)
    && body.candidates[0]
    && body.candidates[0].content
    && body.candidates[0].content.parts) || [];

  return parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
}

/** Everything model-shaped goes through here, and returns plain text either way. */
function callVisionModel(env, prompt, image) {
  return providerFor(env) === 'gemini'
    ? callGemini(env, prompt, image)
    : callAnthropic(env, prompt, image);
}

/* ---------------------------------------------------------------- parsing */

/**
 * Pulls the base64 and its media type out of the request body, or null if there
 * is nothing usable there. The app sends bare base64 JPEG; a data URL prefix is
 * a cheap thing to survive, and its declared type is worth keeping rather than
 * assuming JPEG and handing the model a mislabelled PNG.
 */
function readImage(body) {
  let raw = body && typeof body.image === 'string' ? body.image : '';
  let mediaType = 'image/jpeg';

  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    if (comma < 0) return null;
    const declared = raw.slice(5, comma).split(';')[0].toLowerCase().trim();
    if (declared) {
      const normalised = IMAGE_TYPE_ALIASES[declared] || declared;
      // A type the model does not take is a free 400 here, not a billed call
      // that was always going to come back unreadable.
      if (!IMAGE_TYPES.has(normalised)) return null;
      mediaType = normalised;
    }
    raw = raw.slice(comma + 1);
  }

  const data = raw.trim();
  if (!data || data.length > MAX_IMAGE_CHARS) return null;
  // Junk in the field is a bad request, not a model call worth paying for.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return null;

  return { data, mediaType };
}

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

    const image = readImage(body);
    if (!image) {
      return json({ error: 'bad-image' }, 400, cors);
    }

    // Counted BEFORE the call, not after it succeeds. What this cap exists to
    // limit is spend, and a call that comes back unreadable was billed exactly
    // like one that worked. Counting only successes meant a stranger with the
    // passphrase could loop photos of a brick wall forever: the model obeys
    // rule 6, answers "unreadable", the validator rejects it, and the counter
    // never moved. The ceiling was Cloudflare's 100k requests a day, not this.
    // The cost of counting first is that one of her own bad photos does use a
    // slot, which is honest: it cost the same money.
    if (used !== null) await bumpCount(env, used);

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

    return json(parsed, 200, cors);
  },
};
