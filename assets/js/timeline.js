// Where we are, in weeks.
//
// One date drives the whole app. Before the birth it is the due date and the
// app counts down; the day bub arrives you set the birth date and everything
// switches to their real age, because almost nobody turns up on the due date
// and a week tab that is five days out is worse than no week tab.
//
// Both dates live in localStorage once set, so they can be changed from
// Settings without editing config.js. config.js only seeds the first run.

import { CONFIG } from './config.js';
import { store } from './util.js';

const KEY_DUE = 'dueDate';
const KEY_BORN = 'birthDate';

const MS_DAY = 86400000;

/** Plain YYYY-MM-DD in and out: no timezone, because a birthday is not a moment. */
function parseDay(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Rejects 2027-02-31 and friends, which Date would silently roll over.
  if (date.getMonth() !== Number(match[2]) - 1) return null;
  return date;
}

export function toDayString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/* ------------------------------------------------------------------ stored */

/**
 * config.js seeds the first run only. Once Settings has written a value, that
 * wins, including an empty one: "never set" and "deliberately cleared" are
 * different answers, and conflating them means the date can never be removed.
 */
export function getDueDate() {
  const saved = store.get(KEY_DUE, null);
  if (saved !== null && saved !== undefined) return saved || null;
  return (CONFIG && CONFIG.dueDate) || null;
}

export function getBirthDate() {
  const saved = store.get(KEY_BORN, null);
  if (saved !== null && saved !== undefined) return saved || null;
  return (CONFIG && CONFIG.birthDate) || null;
}

/**
 * Three outcomes, kept distinct: a real date is stored, an empty value clears
 * the date (stored as an empty string, which is how "deliberately cleared" is
 * told apart from "never set"), and anything unparseable is refused without
 * touching what is already there. Rejecting rather than blanking matters: a
 * typo in Settings should not quietly wipe the date the whole app runs on.
 */
export function setDueDate(value) {
  if (value === null || value === '') {
    store.set(KEY_DUE, '');
    return true;
  }
  const parsed = parseDay(value);
  if (!parsed) return false;
  store.set(KEY_DUE, toDayString(parsed));
  return true;
}

/** Same three outcomes as setDueDate. A bad value never clears a good one. */
export function setBirthDate(value) {
  if (value === null || value === '') {
    store.set(KEY_BORN, '');
    return true;
  }
  const parsed = parseDay(value);
  if (!parsed) return false;
  store.set(KEY_BORN, toDayString(parsed));
  return true;
}

export function hasArrived() {
  return Boolean(parseDay(getBirthDate()));
}

/* ------------------------------------------------------------------- where */

/**
 * The anchor is the birth date once it exists, the due date until then, so a
 * countdown becomes an age on the day it should.
 */
function anchor() {
  return parseDay(getBirthDate()) || parseDay(getDueDate());
}

/**
 * { week, day, arrived, daysToGo, anchorDate } or null when no date is set.
 *
 * Week 0 is the first seven days of life, which is how parents and nurses both
 * count. Before the birth the week is negative: week -1 is the last week of the
 * pregnancy, so the lead-up entries line up without a second numbering system.
 */
export function currentPosition(today = startOfToday()) {
  const from = anchor();
  if (!from) return null;

  const days = Math.floor((today - from) / MS_DAY);
  const arrived = hasArrived();

  if (days >= 0) {
    return {
      week: Math.floor(days / 7),
      day: days,
      arrived,
      daysToGo: 0,
      anchorDate: from,
    };
  }

  // Before the anchor: -1 to -7 days is week -1, not week 0.
  return {
    week: -Math.ceil(-days / 7),
    day: days,
    arrived,
    daysToGo: -days,
    anchorDate: from,
  };
}

/** The real calendar dates a given week of life covers. */
export function datesForWeek(week) {
  const from = anchor();
  if (!from || !Number.isFinite(week)) return null;
  const start = new Date(from.getTime() + week * 7 * MS_DAY);
  const end = new Date(start.getTime() + 6 * MS_DAY);
  return { start, end };
}

/**
 * Picks the entry to show for a week from a list that does not carry every
 * week: after the first few months the content thins out to every fourth week,
 * so the most recent entry on or before now is the right one.
 */
export function entryForWeek(weeks, week) {
  if (!Array.isArray(weeks) || !Number.isFinite(week)) return null;
  let best = null;
  for (const entry of weeks) {
    if (!entry || !Number.isFinite(entry.week)) continue;
    if (entry.week > week) continue;
    if (!best || entry.week > best.week) best = entry;
  }
  // Before the first entry, show the earliest rather than nothing.
  if (best) return best;
  return weeks.reduce((low, entry) => (
    entry && Number.isFinite(entry.week) && (!low || entry.week < low.week) ? entry : low
  ), null);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20 May", or "20 May 2027" when the year is not the one we are in. */
export function shortDate(date, today = startOfToday()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === today.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** How old, said the way a person would say it. */
export function ageLabel(position) {
  if (!position) return '';
  if (!position.arrived) {
    if (position.daysToGo > 0) {
      const weeks = Math.floor(position.daysToGo / 7);
      if (weeks >= 2) return `${weeks} weeks to go`;
      if (position.daysToGo === 1) return 'Tomorrow, maybe';
      return `${position.daysToGo} days to go`;
    }
    return 'Any day now';
  }
  if (position.day === 0) return 'Day one';
  if (position.day < 14) return `Day ${position.day + 1}`;
  if (position.week < 14) return `${position.week} weeks old`;
  const months = Math.floor(position.day / 30.44);
  return `${months} months old`;
}
