// Nudges.
//
// What this does and does not do, stated plainly, because notifications are the
// easiest thing in a web app to promise and not deliver.
//
// It does: ask for permission, remember what she wants to be nudged about, and
// when the app is opened after the week has rolled over, show the new week's
// focus. That works on every phone, offline, with no server.
//
// It does not: wake a closed phone on a schedule. That needs the Push API, a
// VAPID key pair and something server side to fire it, and on iPhone it only
// works at all once the app has been added to the home screen. The hooks are
// here and the Worker can carry it later; until then this never pretends.

import { STRINGS } from './strings.js';
import { store } from './util.js';
import { currentPosition, entryForWeek } from './timeline.js';

const KEY_PREFS = 'notify.prefs';
const KEY_SEEN_WEEK = 'notify.seenWeek';

export function supported() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

/** True on an iPhone that has not added the app to the home screen yet. */
export function needsInstall() {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  return iOS && !standalone;
}

export function getPrefs() {
  const saved = store.get(KEY_PREFS, null);
  return {
    weekly: saved ? Boolean(saved.weekly) : false,
    appointments: saved ? Boolean(saved.appointments) : false,
  };
}

export function setPrefs(next) {
  store.set(KEY_PREFS, { weekly: Boolean(next.weekly), appointments: Boolean(next.appointments) });
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

async function show(title, body) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, icon: 'assets/icons/icon-192.png', tag: 'bub-week' });
      return true;
    }
    new Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}

/**
 * Called on open. If the week has turned over since she last saw it, that is
 * worth one nudge. Checked rather than scheduled, so it cannot fire twice and
 * cannot fire for a week she has already read.
 */
export async function checkWeekRollover(weeks) {
  if (!getPrefs().weekly || permission() !== 'granted') return false;

  const position = currentPosition();
  if (!position) return false;

  const seen = store.get(KEY_SEEN_WEEK, null);
  if (seen !== null && Number(seen) === position.week) return false;
  store.set(KEY_SEEN_WEEK, position.week);
  // First run just records where we are; nudging about a week she is already
  // halfway through would be noise.
  if (seen === null) return false;

  const entry = entryForWeek(weeks || [], position.week);
  if (!entry) return false;

  const label = position.week < 0
    ? (STRINGS.week && STRINGS.week.beforeLabel) || 'Before bub'
    : `Week ${position.week}`;
  return show(`${label}: ${entry.title}`, entry.headline || '');
}
