// The two small trackers: caffeine today and fish serves.
//
// Both are budgets, never scoreboards. The caffeine bar tops out at the limit
// in --easy-ink and never goes red, and the fish rows count in dots rather
// than numbers, so neither screen ever reads as a telling-off.
//
// Storage is deliberately disposable. The caffeine day lives under
// ba:caffeine:YYYY-MM-DD, so midnight resets it by construction rather than by
// a timer, and a wiped store costs her a tally, never a verdict.

import { STRINGS } from './strings.js';
import { el, store, todayKey, prefersReducedMotion } from './util.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { getData } from './data.js';
import { stickerHtml } from './sticker.js';

const CAFFEINE_PREFIX = 'caffeine:';
const FISH_KEY = 'fish';

const DEFAULT_LIMIT_MG = 200;

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const FORTNIGHT_MS = 14 * DAY_MS;
// Anything past a fortnight cannot affect either count, so a month of history
// is generous and keeps the stored array small.
const FISH_KEEP_MS = 30 * DAY_MS;

const HIGH_ALLOWANCE = 1;
const OTHER_ALLOWANCE = 3;
const MAX_DOTS = 8;

const POP_MS = 200;
const FILL_MS = 400;
const WOBBLE_MS = 450;
const REDUCED_MS = 150;

// Mirrors --spring and --ease-out in the token block.
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';

const BAR_MIN_H = '14px';

/* ------------------------------------------------------------------ strings */

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

function strList(path) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return [];
    node = node[key];
  }
  return Array.isArray(node) ? node.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/** Fills {name} style slots, and falls back to appending when the slot is gone. */
function fill(template, values) {
  let out = String(template || '');
  let used = false;
  for (const [key, value] of Object.entries(values)) {
    const slot = `{${key}}`;
    if (out.includes(slot)) {
      used = true;
      out = out.split(slot).join(String(value));
    }
  }
  if (used) return out;
  return [out, ...Object.values(values).map(String)].filter(Boolean).join(' ').trim();
}

/* --------------------------------------------------------------------- data */

function bundle() {
  try {
    return getData();
  } catch {
    return null;   // opened before the data landed, which the callers survive
  }
}

function caffeineData() {
  const data = bundle();
  const block = (data && data.caffeine) || {};
  return {
    limitMg: Number(block.limitMg) > 0 ? Number(block.limitMg) : DEFAULT_LIMIT_MG,
    drinks: Array.isArray(block.drinks) ? block.drinks : [],
    note: typeof block.note === 'string' ? block.note : '',
    // Not part of the loader's published bundle shape today, so it is read
    // through a guard and the strings file covers the gap.
    excluded: Array.isArray(block.excluded) ? block.excluded : [],
  };
}

/* -------------------------------------------------------------- caffeine io */

function caffeineKey() {
  return CAFFEINE_PREFIX + todayKey();
}

/** Entries carry their own name and mg, so the tally still reads correctly if
 *  caffeine.json is retuned later in the day. */
function readCaffeine() {
  const saved = store.get(caffeineKey(), []);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry) => entry && typeof entry === 'object' && Number.isFinite(Number(entry.mg)))
    .map((entry) => ({
      id: String(entry.id || ''),
      name: String(entry.name || ''),
      mg: Math.max(0, Number(entry.mg)),
      at: Number(entry.at) || 0,
    }));
}

function writeCaffeine(entries) {
  store.set(caffeineKey(), entries);
}

function totalOf(entries) {
  return entries.reduce((sum, entry) => sum + entry.mg, 0);
}

export function caffeineToday() {
  const entries = readCaffeine();
  return { totalMg: totalOf(entries), entries, limitMg: caffeineData().limitMg };
}

/* ------------------------------------------------------------------ fish io */

function readFish() {
  const saved = store.get(FISH_KEY, []);
  if (!Array.isArray(saved)) return [];
  const now = Date.now();
  return saved
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ kind: entry.kind === 'high' ? 'high' : 'other', at: Number(entry.at) || 0 }))
    .filter((entry) => entry.at > 0 && now - entry.at < FISH_KEEP_MS);
}

function writeFish(entries) {
  store.set(FISH_KEY, entries);
}

function windowFor(kind) {
  return kind === 'high' ? FORTNIGHT_MS : WEEK_MS;
}

/** Entries outside the window are kept on disk but never counted, so a serve
 *  ages out of the tally on its own. */
function countFish(entries, kind) {
  const cutoff = Date.now() - windowFor(kind);
  return entries.filter((entry) => entry.kind === kind && entry.at >= cutoff).length;
}

/* ------------------------------------------------------------------ motion */

function animate(node, frames, options) {
  if (!node || typeof node.animate !== 'function') return null;
  return node.animate(frames, options);
}

/** The chip pop from build spec 5.5: .92 to 1.06 to 1, on the spring. */
function popChip(node) {
  if (prefersReducedMotion()) return;
  animate(node, [
    { transform: 'scale(.92)' },
    { transform: 'scale(1.06)', offset: 0.55 },
    { transform: 'scale(1)' },
  ], { duration: POP_MS, easing: SPRING });
}

/** One gentle sweep when the budget fills. Never repeated, never red. */
function wobble(node) {
  if (prefersReducedMotion()) return;
  animate(node, [
    { transform: 'rotate(0deg)' },
    { transform: 'rotate(-1.5deg)', offset: 0.3 },
    { transform: 'rotate(1.5deg)', offset: 0.7 },
    { transform: 'rotate(0deg)' },
  ], { duration: WOBBLE_MS, easing: 'ease-in-out' });
}

/* ---------------------------------------------------------- caffeine sheet */

function segTransform(offset, width) {
  // translateX is a percentage of the segment's own width, and every segment is
  // laid out at the full track width, so the pair reads as "start here, run
  // this far" without ever touching the width property.
  return `translateX(${(offset * 100).toFixed(3)}%) scaleX(${width.toFixed(4)})`;
}

function segColour(index, atLimit) {
  const base = atLimit ? 'var(--easy-ink)' : 'var(--brand)';
  // Alternating tints keep the stacked drinks readable as separate serves
  // without hairlines, which would distort under scaleX.
  return index % 2 === 0 ? base : `color-mix(in srgb, ${base} 76%, var(--surface))`;
}

function buildBar() {
  const fillLayer = el('div', {
    class: 'bar__fill',
    style: {
      position: 'absolute',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
      // Neutralised on purpose: the segments own the fill, so a stylesheet
      // transform on this layer would scale them a second time.
      transform: 'none',
      overflow: 'hidden',
      borderRadius: 'inherit',
    },
  });

  const bar = el('div', {
    class: 'bar',
    aria: { hidden: 'true' },
    style: { position: 'relative', overflow: 'hidden', minHeight: BAR_MIN_H },
  }, [fillLayer]);

  return { bar, fillLayer };
}

function paintBar(fillLayer, entries, limitMg, animateLast) {
  const total = totalOf(entries);
  const atLimit = total >= limitMg;
  // Over the limit the denominator becomes the total, so the bar sits full
  // rather than spilling past the end of its own track.
  const denominator = Math.max(limitMg, total, 1);

  fillLayer.replaceChildren();

  let cursor = 0;
  const reduced = prefersReducedMotion();

  entries.forEach((entry, index) => {
    if (entry.mg <= 0) return;
    const offset = cursor / denominator;
    const width = entry.mg / denominator;
    cursor += entry.mg;

    const seg = el('span', {
      class: 'bar__seg',
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        height: '100%',
        width: '100%',
        transformOrigin: 'left',
        transform: segTransform(offset, width),
        background: segColour(index, atLimit),
        willChange: 'transform',
      },
    });
    fillLayer.appendChild(seg);

    const isLast = index === entries.length - 1;
    if (!animateLast || !isLast) return;

    if (reduced) {
      animate(seg, [{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: EASE_OUT });
      return;
    }
    animate(seg, [
      { transform: segTransform(offset, 0) },
      { transform: segTransform(offset, width) },
    ], { duration: FILL_MS, easing: SPRING });
  });
}

function caffeineStatusText(total, limitMg) {
  if (total >= limitMg) {
    return str('caffeine.atLimit', "Budget's full for today, and decaf's got your back.");
  }
  if (total <= 0) return str('caffeine.empty', 'Nothing counted yet today.');
  const mg = Math.round(total);
  return fill(
    str('caffeine.running', '{mg}mg so far. {left}mg left in the budget.'),
    { mg, left: Math.max(0, limitMg - mg) },
  );
}

function drinkChip(drink, onAdd) {
  const name = String(drink.name || '').trim();
  const mg = Math.max(0, Number(drink.mg) || 0);
  const emoji = String(drink.emoji || '').trim();
  const unit = str('caffeine.mg', 'mg');

  const chip = el('button', {
    class: 'chip',
    type: 'button',
    aria: { label: fill(str('caffeine.add', 'Add {name}, {mg}{unit}'), { name, mg, unit }) },
  }, [
    emoji ? el('span', { aria: { hidden: 'true' } }, `${emoji} `) : null,
    el('span', {}, name),
    el('span', { class: 'caption' }, ` ${mg}${unit}`),
  ]);

  chip.addEventListener('click', () => {
    popChip(chip);
    onAdd({ id: String(drink.id || name), name, mg });
  });

  return chip;
}

function excludedRow(item) {
  const name = String(item.name || '').trim();
  const emoji = String(item.emoji || '').trim();
  const note = String(item.note || '').trim();

  const row = el('div', { class: 'dish' }, [
    el('span', { class: 'dish__name' }, emoji ? `${emoji} ${name}` : name),
  ]);
  // A HOLD sticker rather than a chip: an energy drink is not something to
  // budget for, so it must not look tappable.
  row.insertAdjacentHTML('beforeend', stickerHtml('red', { mini: true, name }));
  if (note) row.appendChild(el('p', { class: 'dish__why' }, note));
  return row;
}

function buildCaffeine(content) {
  const { limitMg, drinks, note, excluded } = caffeineData();
  let entries = readCaffeine();
  let dayKey = caffeineKey();
  let wobbled = totalOf(entries) >= limitMg;   // already full on open, so no scolding

  // The sheet can sit open across midnight. Entries were read for the day the
  // sheet opened, so a write after the date rolls must start from the new
  // day's (empty) list, not carry yesterday's coffees into it.
  const rolloverGuard = () => {
    if (caffeineKey() === dayKey) return;
    dayKey = caffeineKey();
    entries = readCaffeine();
    wobbled = totalOf(entries) >= limitMg;
  };

  content.appendChild(el('h2', { class: 'verdict__name' }, str('caffeine.title', 'Caffeine today')));

  const { bar, fillLayer } = buildBar();
  content.appendChild(bar);

  const status = el('p', { role: 'status' }, caffeineStatusText(totalOf(entries), limitMg));
  content.appendChild(status);

  const undo = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    disabled: entries.length === 0,
  }, [str('caffeine.undo', 'Undo last')]);
  undo.insertAdjacentHTML('afterbegin', icon('undo', { size: 20 }));

  const repaint = (animateLast) => {
    const total = totalOf(entries);
    paintBar(fillLayer, entries, limitMg, animateLast);
    status.textContent = caffeineStatusText(total, limitMg);
    undo.disabled = entries.length === 0;
    if (animateLast && total >= limitMg && !wobbled) {
      wobbled = true;
      wobble(bar);
    }
    if (total < limitMg) wobbled = false;
  };

  const chips = el('div', {
    class: 'chips',
    role: 'group',
    aria: { label: str('caffeine.chipsLabel', 'Add a drink') },
  }, drinks.map((drink) => drinkChip(drink, (entry) => {
    rolloverGuard();
    entries = [...entries, { ...entry, at: Date.now() }];
    writeCaffeine(entries);
    repaint(true);
  })));
  content.appendChild(chips);

  undo.addEventListener('click', () => {
    rolloverGuard();
    if (!entries.length) return;
    entries = entries.slice(0, -1);
    writeCaffeine(entries);
    repaint(false);
  });
  content.appendChild(undo);

  const excludedItems = excluded.length ? excluded : [{
    name: str('caffeine.energy.name', 'Energy drink'),
    emoji: '⚡',
    note: str('caffeine.energyNote', 'Energy drinks sit outside the tally. Caffeine plus guarana is a Not now rather than something to budget for.'),
  }];
  for (const item of excludedItems) content.appendChild(excludedRow(item));

  const noteText = note || str('caffeine.note', 'Values are averages, so treat the bar as a guide.');
  if (noteText) content.appendChild(el('p', { class: 'caption' }, noteText));
  content.appendChild(el('p', { class: 'caption' }, str('caffeine.resetNote', 'The tally clears itself at midnight.')));

  repaint(false);
}

/* -------------------------------------------------------------- fish sheet */

function dotsEl(used, allowance) {
  const shown = Math.min(Math.max(allowance, used), MAX_DOTS);
  const dots = el('div', { class: 'dots', aria: { hidden: 'true' } });
  for (let i = 0; i < shown; i += 1) {
    dots.appendChild(el('span', { class: i < used ? 'dot is-on' : 'dot' }));
  }
  return dots;
}

/**
 * Dots carry the count visually, and this sentence carries it for VoiceOver and
 * for anyone who cannot separate a filled dot from an empty one.
 */
function countText(used, allowance) {
  return fill(str('fish.dotsLabel', '{used} of {total} serves used'), { used, total: allowance });
}

function fishRow(kind, allowance, state) {
  const label = kind === 'high'
    ? str('fish.fortnightLabel', 'High-mercury serve, this fortnight')
    : str('fish.weekLabel', 'Other fish serves, this week');
  const window = kind === 'high'
    ? str('fish.high.window', 'This fortnight')
    : str('fish.other.window', 'This week');
  const why = kind === 'high'
    ? str('fish.flake', 'Flake at the fish and chip shop IS shark. Shark, swordfish, broadbill and marlin carry the most mercury, so it is one serve a fortnight, and no other fish in that fortnight.')
    : str('fish.weekRule', 'Orange roughy (sea perch) and catfish are once a week, with no other fish that week.');

  const card = el('section', { class: 'card' });
  card.appendChild(el('h3', { class: 'group-title' }, label));
  card.appendChild(el('p', { class: 'caption' }, window));

  const dotsHost = el('div', {});
  const readout = el('p', { class: 'sr-only', role: 'status' });
  card.append(dotsHost, readout);
  card.appendChild(el('p', {}, why));

  const addLabel = kind === 'high'
    ? str('fish.addHigh', 'Add a high-mercury serve')
    : str('fish.addOther', 'Add a serve');
  const add = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    aria: { label: addLabel },
  }, [addLabel]);
  add.insertAdjacentHTML('afterbegin', icon('plus', { size: 20 }));

  const undo = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    aria: { label: str('fish.undo', 'Undo last') },
  }, [str('fish.undo', 'Undo last')]);
  undo.insertAdjacentHTML('afterbegin', icon('undo', { size: 20 }));

  const paint = () => {
    const used = countFish(state.entries, kind);
    dotsHost.replaceChildren(dotsEl(used, allowance));
    readout.textContent = `${label}, ${window}: ${countText(used, allowance)}`;
    undo.disabled = used === 0;
  };

  add.addEventListener('click', () => {
    popChip(add);
    state.entries = [...state.entries, { kind, at: Date.now() }];
    writeFish(state.entries);
    state.paintAll();
  });

  undo.addEventListener('click', () => {
    const cutoff = Date.now() - windowFor(kind);
    let last = -1;
    state.entries.forEach((entry, index) => {
      if (entry.kind === kind && entry.at >= cutoff) last = index;
    });
    if (last < 0) return;
    state.entries = state.entries.filter((entry, index) => index !== last);
    writeFish(state.entries);
    state.paintAll();
  });

  card.append(add, undo);
  return { card, paint };
}

function buildFish(content) {
  const state = { entries: readFish(), paintAll: () => {} };

  content.appendChild(el('h2', { class: 'verdict__name' }, str('fish.title', 'Fish tracker')));
  content.appendChild(el('p', {}, str(
    'fish.intro',
    'Fish is encouraged: 1 to 3 serves a week, and a serve is about 150g.',
  )));

  const high = fishRow('high', HIGH_ALLOWANCE, state);
  const other = fishRow('other', OTHER_ALLOWANCE, state);
  content.append(high.card, other.card);

  state.paintAll = () => {
    high.paint();
    other.paint();
  };
  state.paintAll();

  content.appendChild(el('p', { class: 'caption' }, str(
    'fish.flake',
    'Heads-up: flake at the fish and chip shop is shark, which is the high-mercury one. Ask what the fish of the day is.',
  )));

  const extra = [
    str('fish.tinNote', 'A small tin of tuna counts as half a serve, so a few tins across the week is fine.'),
    str('fish.encourage', 'Two serves of cooked-through fish a week is a genuine win for you both.'),
  ];
  for (const line of extra) content.appendChild(el('p', { class: 'caption' }, line));
}

/* --------------------------------------------------------------------- API */

export function openCaffeineSheet({ fromEl } = {}) {
  return openSheet({
    id: 'caffeine',
    label: str('caffeine.title', 'Caffeine today'),
    fromEl,
    build: buildCaffeine,
  });
}

export function openFishSheet({ fromEl } = {}) {
  return openSheet({
    id: 'fish',
    label: str('fish.title', 'Fish tracker'),
    fromEl,
    build: buildFish,
  });
}
