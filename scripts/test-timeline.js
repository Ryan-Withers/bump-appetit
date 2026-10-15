#!/usr/bin/env node
// The week maths, tested against the real timeline module.
//
// Everything in the app hangs off one date: which week the Week tab shows,
// which appointments are due, what a notification says. Week 0 being the first
// seven days and week -1 being the last week before the birth are both easy to
// get off by one, and nobody would notice until the wrong week was on screen.
//
// Run: node scripts/test-timeline.js

import { pathToFileURL } from 'node:url';
import path from 'node:path';

// The module reaches for window.localStorage through util.js, which falls back
// to an in-memory map when it throws. A bare stub is enough to run it in Node.
globalThis.window = { localStorage: {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
} };


const ROOT = path.resolve(import.meta.dirname, '..');
const T = await import(pathToFileURL(path.join(ROOT, 'assets/js/timeline.js')).href);

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed += 1; else failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  :: ${detail}` : ''}`);
};

const day = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/* --------------------------------------------------------------- the anchor */

T.setDueDate('2027-04-15');
T.setBirthDate(null);

check('no birth date yet means not arrived', T.hasArrived() === false);

let pos = T.currentPosition(day('2027-04-15'));
check('the due date itself is day 0, week 0', pos.day === 0 && pos.week === 0, JSON.stringify(pos));

pos = T.currentPosition(day('2027-04-08'));
check('a week before the due date is week -1', pos.week === -1 && pos.daysToGo === 7, JSON.stringify(pos));

pos = T.currentPosition(day('2027-04-14'));
check('the day before is still week -1, not week 0', pos.week === -1 && pos.daysToGo === 1, JSON.stringify(pos));

pos = T.currentPosition(day('2027-03-04'));
check('six weeks out is week -6, which is where the lead-up starts',
  pos.week === -6, JSON.stringify(pos));

/* ------------------------------------------------- the switch to a real age */

// Bub turns up eight days early, which is the normal case the app must handle.
T.setBirthDate('2027-04-07');
check('setting a birth date means arrived', T.hasArrived() === true);

pos = T.currentPosition(day('2027-04-07'));
check('birth day is day 0 of week 0', pos.day === 0 && pos.week === 0 && pos.arrived);

pos = T.currentPosition(day('2027-04-13'));
check('day 6 is still week 0, the whole first week', pos.week === 0, JSON.stringify(pos));

pos = T.currentPosition(day('2027-04-14'));
check('day 7 starts week 1', pos.week === 1 && pos.day === 7, JSON.stringify(pos));

pos = T.currentPosition(day('2027-05-19'));
check('six weeks after the birth is week 6, the smiles-and-needles week',
  pos.week === 6, JSON.stringify(pos));

check('the birth date overrides the due date entirely',
  T.currentPosition(day('2027-04-15')).day === 8,
  JSON.stringify(T.currentPosition(day('2027-04-15'))));

/* ------------------------------------------------------------------- dates */

const w6 = T.datesForWeek(6);
check('week 6 starts six weeks after the birth',
  T.toDayString(w6.start) === '2027-05-19', T.toDayString(w6.start));
check('and runs seven days', T.toDayString(w6.end) === '2027-05-25', T.toDayString(w6.end));

/* ------------------------------------------- picking content for a week */

const weeks = [{ week: -6 }, { week: 0 }, { week: 1 }, { week: 6 }, { week: 13 }, { week: 17 }];
check('an exact week match wins', T.entryForWeek(weeks, 6).week === 6);
check('a week with no entry falls back to the most recent one before it',
  T.entryForWeek(weeks, 15).week === 13, String(T.entryForWeek(weeks, 15).week));
check('past the last entry it holds on the last one',
  T.entryForWeek(weeks, 52).week === 17);
check('before the first entry it shows the earliest rather than nothing',
  T.entryForWeek(weeks, -99).week === -6);

/* ----------------------------------------------------------------- wording */

T.setBirthDate(null);
check('counting down reads as weeks to go',
  T.ageLabel(T.currentPosition(day('2027-03-18'))) === '4 weeks to go',
  T.ageLabel(T.currentPosition(day('2027-03-18'))));
check('the last day does not say "0 weeks to go"',
  T.ageLabel(T.currentPosition(day('2027-04-14'))) === 'Tomorrow, maybe',
  T.ageLabel(T.currentPosition(day('2027-04-14'))));

T.setBirthDate('2027-04-07');
check('the first day says day one, not day zero',
  T.ageLabel(T.currentPosition(day('2027-04-07'))) === 'Day one',
  T.ageLabel(T.currentPosition(day('2027-04-07'))));
check('early days are counted in days',
  T.ageLabel(T.currentPosition(day('2027-04-12'))) === 'Day 6',
  T.ageLabel(T.currentPosition(day('2027-04-12'))));
check('then weeks', T.ageLabel(T.currentPosition(day('2027-05-19'))) === '6 weeks old',
  T.ageLabel(T.currentPosition(day('2027-05-19'))));
check('then months', T.ageLabel(T.currentPosition(day('2027-10-07'))) === '6 months old',
  T.ageLabel(T.currentPosition(day('2027-10-07'))));

/* -------------------------------------------------------------- bad input */

check('a nonsense date is refused rather than stored', T.setDueDate('not a date') === false);
check('and 31 February is refused too', T.setDueDate('2027-02-31') === false);
check('no date at all returns no position', (() => {
  T.setDueDate('');
  T.setBirthDate(null);
  const saved = T.currentPosition(day('2027-04-15'));
  T.setDueDate('2027-04-15');
  return saved === null;
})());

console.log('');
if (failures.length) {
  console.log(`Timeline failed: ${failures.length} problem${failures.length > 1 ? 's' : ''}.`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`Timeline checks out: ${passed}/${passed} passed.`);
