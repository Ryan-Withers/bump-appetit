// Two phones, one household.
//
// Everything the two of you tick, log or change lands here: the buy list, the
// stage checklists, the feed and sleep log. The hard requirement is that it
// works at 3am in a nursery with one bar of signal, so this is local first.
// Every write hits localStorage immediately and the screen updates; the network
// is an afterthought that catches up when it can.
//
// The merge rule is last write wins PER KEY, never per document. If Ryan ticks
// the pram on his phone while Emma ticks the bassinet on hers, both offline,
// a whole-document merge would throw one of them away. Per key, both survive.
//
// Unacknowledged changes sit in an outbox until the server echoes them back, so
// a request that is lost, or clobbered by a simultaneous write from the other
// phone, is simply sent again rather than quietly disappearing.

import { CONFIG } from './config.js';
import { store } from './util.js';

const KEY_STATE = 'sync.state';     // { [key]: { v, at, by } }
const KEY_OUTBOX = 'sync.outbox';   // { [key]: true }
const KEY_HOUSEHOLD = 'sync.household';
const KEY_DEVICE = 'sync.device';
const KEY_PULLED = 'sync.pulledAt';

const PUSH_DEBOUNCE_MS = 1200;
const MIN_PULL_GAP_MS = 4000;

let timer = null;
let inFlight = false;
const listeners = new Set();

/* ---------------------------------------------------------------- identity */

export function getHousehold() {
  return String(store.get(KEY_HOUSEHOLD, '') || '').trim();
}

export function setHousehold(code) {
  const clean = String(code || '').trim().toLowerCase().replace(/\s+/g, '-');
  store.set(KEY_HOUSEHOLD, clean);
  return clean;
}

/** Whose phone this is. Shown against a logged feed, so "did you feed her" has an answer. */
export function getDevice() {
  return String(store.get(KEY_DEVICE, '') || '').trim();
}

export function setDevice(name) {
  store.set(KEY_DEVICE, String(name || '').trim().slice(0, 24));
}

export function isLinked() {
  const ask = (CONFIG && CONFIG.ask) || {};
  return Boolean(getHousehold() && String(ask.endpoint || '').trim());
}

/* ------------------------------------------------------------------- state */

function readState() {
  const raw = store.get(KEY_STATE, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function readOutbox() {
  const raw = store.get(KEY_OUTBOX, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/** The current value for a key, or the fallback when it has never been set. */
export function get(key, fallback = null) {
  const record = readState()[String(key)];
  return record && 'v' in record ? record.v : fallback;
}

/** Every key under a prefix, as a plain object. Used for "all the ticks". */
export function getAll(prefix = '') {
  const out = {};
  for (const [key, record] of Object.entries(readState())) {
    if (prefix && !key.startsWith(prefix)) continue;
    if (record && 'v' in record) out[key] = record.v;
  }
  return out;
}

/**
 * Writes locally and schedules a push. The timestamp is what the merge sorts
 * on, so it is taken here, at the moment of the tap, not when the network
 * eventually carries it.
 */
export function set(key, value) {
  const id = String(key);
  const state = readState();
  state[id] = { v: value, at: Date.now(), by: getDevice() || 'someone' };
  store.set(KEY_STATE, state);

  const outbox = readOutbox();
  outbox[id] = true;
  store.set(KEY_OUTBOX, outbox);

  emit();
  schedulePush();
  return value;
}

export function subscribe(fn) {
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A broken listener must never stop the others, or a tick stops painting.
    }
  }
}

/**
 * Merges a server document into local state. A remote record only wins when it
 * is strictly newer, so a push still sitting in the outbox is never overwritten
 * by the older copy the server happens to be holding.
 */
function merge(remote) {
  if (!remote || typeof remote !== 'object') return false;
  const state = readState();
  let changed = false;

  for (const [key, record] of Object.entries(remote)) {
    if (!record || typeof record !== 'object' || !('v' in record)) continue;
    const at = Number(record.at) || 0;
    const mine = state[key];
    if (mine && Number(mine.at || 0) >= at) continue;
    state[key] = { v: record.v, at, by: String(record.by || '') };
    changed = true;
  }

  if (changed) store.set(KEY_STATE, state);
  return changed;
}

/* ------------------------------------------------------------------ the wire */

function schedulePush() {
  if (!isLinked()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; sync(); }, PUSH_DEBOUNCE_MS);
}

/**
 * One round trip: send whatever is in the outbox, take back everything the
 * other phone has done. Safe to call often; it no-ops while one is in flight.
 */
export async function sync({ force = false } = {}) {
  if (!isLinked() || inFlight) return false;

  const outbox = readOutbox();
  const keys = Object.keys(outbox);
  const pulledAt = Number(store.get(KEY_PULLED, 0)) || 0;

  // Nothing to say and nothing likely to have changed: skip the request.
  if (!force && !keys.length && Date.now() - pulledAt < MIN_PULL_GAP_MS) return false;

  const state = readState();
  const changes = {};
  for (const key of keys) if (state[key]) changes[key] = state[key];

  const ask = (CONFIG && CONFIG.ask) || {};
  const url = `${String(ask.endpoint).trim().replace(/\/+$/, '')}/sync`;

  inFlight = true;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bub-pass': String(ask.pass || '') },
      body: JSON.stringify({ household: getHousehold(), changes }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return false;

    const body = await res.json();
    const changedByMerge = merge(body && body.state);

    // Only clear what the server actually confirmed. Anything else stays in the
    // outbox and goes again next time, which is what makes a lost or clobbered
    // write self healing rather than silently gone.
    const acked = (body && body.acked) || [];
    if (acked.length) {
      const next = readOutbox();
      for (const key of acked) delete next[key];
      store.set(KEY_OUTBOX, next);
    }

    store.set(KEY_PULLED, Date.now());
    if (changedByMerge) emit();
    return true;
  } catch {
    // Offline, or the Worker is asleep. The outbox keeps everything; the next
    // open, focus or tick tries again. Nothing to tell her about.
    return false;
  } finally {
    inFlight = false;
  }
}

/** How many of her taps are still waiting for signal. Shown quietly in Settings. */
export function pendingCount() {
  return Object.keys(readOutbox()).length;
}

export function lastPulledAt() {
  return Number(store.get(KEY_PULLED, 0)) || 0;
}

/** Wires the moments worth syncing on: opening the app, coming back to it, reconnecting. */
export function startSync() {
  if (!isLinked()) return;
  sync({ force: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  window.addEventListener('online', () => sync({ force: true }));
  window.addEventListener('focus', () => sync());
}
