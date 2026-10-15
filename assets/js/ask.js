// Ask: the AI search.
//
// She types a question in her own words. The phone searches its own notes
// first, and the entries that matched are the ONLY material the model is given.
// It never searches the web and never answers from memory, so the worst case is
// "that one is not in here, ring your nurse line" rather than a confident
// invention at 3am.
//
// Retrieval happens here rather than on the server because the phone already
// holds every entry and already has a good search over them. That keeps the
// Worker stateless, keeps the data off the wire, and means the local answers
// stay available when Ask is not.

import { CONFIG } from './config.js';
import { search } from './search.js';
import { entryById } from './data.js';

const NOTE_LIMIT = 8;

// Said out loud, these would end the conversation and start a phone call. The
// model is told the same rule, but it is checked here as well: a network blip
// must never be the reason a parent does not see this.
const RED_FLAGS = [
  /\bnot breathing\b/i, /\bstopped breathing\b/i, /\bstruggling to breathe\b/i,
  /\bcan'?t breathe\b/i, /\btrouble breathing\b/i, /\bgasping\b/i,
  /\bturning blue\b/i, /\bwent blue\b/i, /\bblue lips\b/i, /\bgrey\b/i,
  /\bunresponsive\b/i, /\bwon'?t wake\b/i, /\bfloppy\b/i, /\blimp\b/i,
  /\bconvulsion\b/i, /\bseizure\b/i, /\bfitting\b/i,
  /\brash.*(won'?t|does ?n'?t) fade\b/i, /\bnon.?blanching\b/i,
  /\bchoking\b/i, /\bfell\b.*\b(head|stairs|cot)\b/i,
];

export function hasAsk() {
  const ask = (CONFIG && CONFIG.ask) || {};
  return Boolean(String(ask.endpoint || '').trim() && String(ask.pass || '').trim());
}

function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function looksUrgent(question) {
  const text = String(question || '');
  return RED_FLAGS.some((re) => re.test(text));
}

function askError(kind) {
  const err = new Error(kind);
  err.kind = kind;
  return err;
}

/**
 * The entries to ground the answer in. Deliberately generous compared with the
 * five shown on screen: a question phrased sideways often matches the right
 * note at rank six, and the model can ignore what does not apply.
 */
export function gatherNotes(question, limit = NOTE_LIMIT) {
  const state = search(question, limit);
  const notes = [];
  for (const hit of state.results) {
    const entry = hit && hit.entry;
    if (!entry) continue;
    notes.push({
      id: entry.id,
      name: entry.name,
      tier: entry.tier,
      why: entry.why || '',
      whatToDo: entry.whatToDo || '',
      whoToCall: entry.whoToCall || '',
      variants: Array.isArray(entry.variants)
        ? entry.variants.map((v) => ({ label: v.label, tier: v.tier, why: v.why }))
        : null,
    });
  }
  return notes;
}

/**
 * Resolves to { answer, used, ring, grounded, entries }.
 *
 * `entries` are the real entry objects behind `used`, so the sheet can show the
 * cards the answer came from. That is the honesty mechanism: she can always
 * read the note herself rather than taking the summary on trust.
 */
export async function ask(question, { signal } = {}) {
  const text = String(question || '').trim();
  if (!text) throw askError('empty');
  if (!hasAsk()) throw askError('no-endpoint');
  if (offline()) throw askError('offline');

  const notes = gatherNotes(text);
  const cfg = (CONFIG && CONFIG.ask) || {};
  const url = `${String(cfg.endpoint).trim().replace(/\/+$/, '')}/ask`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(cfg.timeoutMs) || 45000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bub-pass': String(cfg.pass || '') },
      body: JSON.stringify({ question: text, notes }),
      signal: controller.signal,
    });

    if (res.status === 429) throw askError('limit');
    if (!res.ok) throw askError('failed');

    const body = await res.json();
    if (!body || typeof body.answer !== 'string') throw askError('failed');

    const used = Array.isArray(body.used) ? body.used : [];
    return {
      answer: body.answer,
      used,
      ring: body.ring || null,
      grounded: Boolean(body.grounded) && used.length > 0,
      entries: used.map((id) => entryById(id)).filter(Boolean),
    };
  } catch (cause) {
    if (cause && cause.kind) throw cause;
    if (signal && signal.aborted) throw askError('cancelled');
    throw askError(offline() ? 'offline' : 'failed');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
