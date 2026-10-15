// Bub Appetit: the Ask endpoint, and the two-phone sync.
//
// The static site cannot hold a model API key, so this Worker holds it. It does
// exactly two things, and refuses a great deal on purpose.
//
// POST /ask   The phone has already searched its own notes and sends the
//             question plus the handful of entries that matched. Those notes
//             are the ONLY thing the model is allowed to answer from. It does
//             not search the web, it does not answer from memory, and when the
//             notes do not cover the question it says so and hands back a phone
//             number. An app for frightened parents that invents a reassuring
//             answer is worse than no app.
//
// POST /sync  A shared key-value store for one household, merged per key by
//             timestamp so two phones can both be offline, both tick things,
//             and both survive. See assets/js/sync.js for the other half.
//
// Also, always: no wildcard CORS, no request without the shared passphrase, and
// a hard daily cap counted in KV before the model is called, because what is
// being capped is spend and a failed call still bills.
//
// Secrets: PASS and MODEL_KEY. Bindings: KV. See wrangler.toml.

const DAILY_LIMIT = 120;

const MAX_QUESTION = 400;
const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 900;
const MAX_ANSWER = 700;

const MODEL_TIMEOUT_MS = 30000;
const DEFAULT_MODEL = 'claude-sonnet-5-5';

// One household document, one phone's worth of ticks and logs. Generous, and
// still far under the KV value ceiling.
const MAX_SYNC_KEYS = 4000;
const MAX_SYNC_BYTES = 512_000;
const HOUSEHOLD_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

const WHO_VALUES = ['000', 'GP', 'MCH nurse', 'Nurse line', 'ABA helpline', 'Red Nose line'];

/**
 * The guard rails, written as instructions rather than hopes.
 *
 * The shape of the risk here is specific: a tired parent asks something in
 * their own words at 3am, the notes do not quite cover it, and a helpful model
 * fills the gap from general knowledge. That answer would look exactly as
 * confident as a real one. So the refusal path is spelled out first, given an
 * explicit output shape, and the app checks the shape before showing anything.
 */
const SYSTEM_PROMPT = `You answer questions for two new parents in Melbourne, Australia, inside an app
called Bub Appetit. Their baby is a newborn. It is often the middle of the night.

YOU ANSWER ONLY FROM THE NOTES SUPPLIED IN THE USER MESSAGE.
The notes are entries from this app, each already written from Raising Children
Network, Red Nose, the Australian Breastfeeding Association or the Royal
Children's Hospital. They are your entire world. You have no other knowledge for
this task.

- Never add a medical fact that is not in the notes, however certain you are.
- Never diagnose. Describe what the notes say and who to ring.
- Never give a medication dose, amount, brand or product name. Not once, not
  even if asked directly. Say it is a question for a pharmacist or GP.
- If the notes do not actually answer what was asked, say so plainly and point
  them at their nurse line. That is a good answer, not a failure.
- Never contradict a note. If a note says ring someone, your answer says ring
  someone, and it says it first.

THE OVERRIDE. If the question describes any of these, your answer must START
with the instruction to ring 000, whatever the notes say:
trouble breathing, long pauses in breathing, blue or grey lips or skin, a fit or
convulsion, floppy or unrousable, a rash that does not fade when pressed, or a
baby who has been injured. Also: any fever in a baby under 3 months old means
being seen today, and after hours that means the emergency department.

VOICE. Australian spelling. Second person. Warm, short, specific. Two to four
sentences. No preamble, no "great question", no lecture, and absolutely no
guilt. They are already doing their best. Humour is fine for a plainly normal
thing and completely wrong anywhere near a phone number.

OUTPUT. Reply with ONE JSON object and nothing else:
{"answer":"...","used":["entry-id"],"ring":null,"grounded":true}
- "answer": what they read. Plain text, no markdown, under 500 characters.
- "used": the ids of the notes you actually used. Empty if none applied.
- "ring": null, or one of "000", "GP", "MCH nurse", "Nurse line",
  "ABA helpline", "Red Nose line" when they should pick up the phone.
- "grounded": true if the notes answered it, false if you had to say you do not
  have it. When false, "answer" says so and "used" is empty.`;

/* ------------------------------------------------- CORS, guards, plumbing */

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGIN) || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

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

function sameSecret(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ quota */

function todayKey() {
  return `asks:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * KV reads are eventually consistent, so two questions landing in the same
 * second can both see the same count. That is fine: this is a guard against a
 * stranger who found the URL, not a billing ledger.
 */
async function readCount(env) {
  if (!env || !env.KV) return null;
  try {
    const raw = await env.KV.get(todayKey());
    const used = Number(raw);
    return Number.isFinite(used) ? used : 0;
  } catch {
    // A failed read must never block a real question.
    return null;
  }
}

async function bumpCount(env, used) {
  if (!env || !env.KV || used === null) return;
  try {
    await env.KV.put(todayKey(), String(used + 1), { expirationTtl: 172800 });
  } catch {
    // Losing a tick of the counter is cheaper than losing the answer.
  }
}

/* -------------------------------------------------------------- the model */

function modelId(env) {
  return String((env && env.MODEL) || '').trim() || DEFAULT_MODEL;
}

function tidy(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

/**
 * Renders the matched entries as the model's entire source material. Everything
 * it is allowed to say has to be visible in here, which is why whoToCall and
 * the tier come along rather than just the prose.
 */
function renderNotes(notes) {
  return notes.map((note, i) => {
    const bits = [`NOTE ${i + 1}`, `id: ${note.id}`, `topic: ${note.name}`, `verdict: ${note.tier}`];
    if (note.why) bits.push(`what it says: ${note.why}`);
    if (note.whatToDo) bits.push(`what to do: ${note.whatToDo}`);
    if (note.whoToCall) bits.push(`who to ring: ${note.whoToCall}`);
    if (Array.isArray(note.variants)) {
      for (const v of note.variants) {
        if (v && v.label) bits.push(`  - ${v.label} (${v.tier}): ${v.why || ''}`);
      }
    }
    return tidy(bits.join('\n'), MAX_NOTE_CHARS);
  }).join('\n\n');
}

async function callModel(env, question, notes) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(env.MODEL_KEY || ''),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId(env),
      max_tokens: 700,
      // Zero. This is not a place for flair.
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `THE NOTES YOU MAY USE:\n\n${renderNotes(notes)}\n\nTHE QUESTION:\n${question}\n\nJSON only.`,
      }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* status says most of it */ }
    console.warn(`ask: model answered ${res.status}`, detail);
    return '';
  }

  const body = await res.json();
  return (Array.isArray(body && body.content) ? body.content : [])
    .map((part) => (part && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/**
 * Nothing the model says reaches the app unchecked. A malformed answer, an
 * invented `ring` value or a `used` id that was never in the notes all collapse
 * to the honest fallback rather than being shown.
 */
function parseAnswer(raw, allowedIds) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  }
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

  const answer = tidy(parsed.answer, MAX_ANSWER);
  if (!answer) return null;

  const used = (Array.isArray(parsed.used) ? parsed.used : [])
    .filter((id) => typeof id === 'string' && allowedIds.has(id))
    .slice(0, MAX_NOTES);

  // An invented phone target is dropped rather than shown. Sending someone to a
  // service that was never in the notes is the one thing worse than no answer.
  const ring = WHO_VALUES.includes(parsed.ring) ? parsed.ring : null;

  return { answer, used, ring, grounded: parsed.grounded !== false && used.length > 0 };
}

/* --------------------------------------------------------------- handlers */

async function handleAsk(req, env, cors) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad-request' }, 400, cors);
  }

  const question = tidy(body && body.question, MAX_QUESTION);
  if (!question) return json({ error: 'bad-request' }, 400, cors);

  const notes = (Array.isArray(body && body.notes) ? body.notes : [])
    .filter((n) => n && typeof n.id === 'string' && typeof n.name === 'string')
    .slice(0, MAX_NOTES);

  // No notes means the phone's own search found nothing, and there is nothing
  // to ground an answer in. Say so here rather than paying for a model call
  // that is only allowed to say the same thing.
  if (!notes.length) {
    return json({ answer: '', used: [], ring: 'Nurse line', grounded: false }, 200, cors);
  }

  const used = await readCount(env);
  if (used !== null && used >= DAILY_LIMIT) {
    return json({ error: 'daily-limit' }, 429, cors);
  }
  await bumpCount(env, used);

  const raw = await callModel(env, question, notes);
  const parsed = parseAnswer(raw, new Set(notes.map((n) => n.id)));
  if (!parsed) return json({ error: 'failed' }, 502, cors);

  return json(parsed, 200, cors);
}

/**
 * The shared household document. Merge is per key by timestamp, and it happens
 * here rather than on the phone so two phones pushing at once converge on the
 * same answer instead of each overwriting the other wholesale.
 */
async function handleSync(req, env, cors) {
  if (!env || !env.KV) return json({ error: 'no-store' }, 503, cors);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad-request' }, 400, cors);
  }

  const household = String((body && body.household) || '').trim().toLowerCase();
  if (!HOUSEHOLD_RE.test(household)) return json({ error: 'bad-household' }, 400, cors);

  const changes = (body && body.changes) || {};
  if (typeof changes !== 'object' || Array.isArray(changes)) {
    return json({ error: 'bad-request' }, 400, cors);
  }

  const key = `hh:${household}`;
  let state = {};
  try {
    const raw = await env.KV.get(key);
    if (raw) state = JSON.parse(raw) || {};
  } catch {
    state = {};
  }

  const acked = [];
  let dirty = false;
  for (const [id, record] of Object.entries(changes)) {
    if (!record || typeof record !== 'object' || !('v' in record)) continue;
    const at = Number(record.at) || 0;
    const mine = state[id];
    // Acknowledge either way: if the stored copy is already newer, this phone's
    // write is genuinely settled and should leave its outbox.
    acked.push(id);
    if (mine && Number(mine.at || 0) >= at) continue;
    state[id] = { v: record.v, at, by: String(record.by || '').slice(0, 24) };
    dirty = true;
  }

  if (Object.keys(state).length > MAX_SYNC_KEYS) {
    return json({ error: 'too-big' }, 413, cors);
  }

  if (dirty) {
    const payload = JSON.stringify(state);
    if (payload.length > MAX_SYNC_BYTES) return json({ error: 'too-big' }, 413, cors);
    try {
      await env.KV.put(key, payload);
    } catch {
      // The write failed, so nothing is acknowledged and the phone keeps its
      // outbox and tries again. Losing a tick silently is the thing to avoid.
      return json({ state, acked: [] }, 200, cors);
    }
  }

  return json({ state, acked }, 200, cors);
}

/* ------------------------------------------------------------------- main */

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (req.method === 'OPTIONS') return preflight(env, req, origin);
    if (!originAllowed(env, origin)) return json({ error: 'forbidden' }, 403, cors);
    if (req.method !== 'POST') {
      return json({ error: 'method' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
    }
    if (!sameSecret(req.headers.get('x-bub-pass'), env && env.PASS)) {
      return json({ error: 'unauthorised' }, 401, cors);
    }

    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (path.endsWith('/ask')) return handleAsk(req, env, cors);
    if (path.endsWith('/sync')) return handleSync(req, env, cors);
    return json({ error: 'not-found' }, 404, cors);
  },
};
