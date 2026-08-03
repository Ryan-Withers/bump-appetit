// Bites: the "I know it is safe, but what do I actually eat" screen.
//
// Every recipe in meals.json is already green by construction, so this view
// carries no verdicts. Its whole job is to get her from a filter chip to a
// tickable ingredient list in as few taps as possible, one-handed.

import { STRINGS } from '../strings.js';
import { el, prefersReducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { openSheet } from '../sheet.js';
import { getData } from '../data.js';

const VIEW_ID = 'bites';

const STAGGER_MS = 24;
const ROW_MS = 240;
const REDUCED_MS = 150;
const STAGGER_ROWS = 6;
const DRIFT_PX = 8;

const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';

/**
 * The chip row, in order. `type` chips filter on meals.json's `type`, `tag`
 * chips on its closed tag set, and `all` is the reset.
 */
const FILTERS = Object.freeze([
  { id: 'all' },
  { id: 'snacks', type: 'snack' },
  { id: 'meals', type: 'meal' },
  { id: 'sweet-treat', tag: 'sweet-treat' },
  { id: '5-minute', tag: '5-minute' },
  { id: 'craving-buster', tag: 'craving-buster' },
  { id: 'nausea-friendly', tag: 'nausea-friendly' },
  { id: 'iron-boost', tag: 'iron-boost' },
  { id: 'freezer-friendly', tag: 'freezer-friendly' },
]);

const FILTER_LABELS = Object.freeze({
  'all': 'All',
  'snacks': 'Snacks',
  'meals': 'Meals',
  'sweet-treat': 'Sweet',
  '5-minute': '5-minute',
  'craving-buster': 'Craving buster',
  'nausea-friendly': 'Nausea-friendly',
  'iron-boost': 'Iron boost',
  'freezer-friendly': 'Freezer',
});

const TAG_LABELS = Object.freeze({
  'craving-buster': 'Craving buster',
  'nausea-friendly': 'Nausea-friendly',
  'iron-boost': 'Iron boost',
  'calcium': 'Calcium',
  'omega-3': 'Omega-3',
  '5-minute': '5-minute',
  'lunchbox': 'Lunchbox',
  'freezer-friendly': 'Freezer',
  'date-night': 'Date night',
  'sweet-treat': 'Sweet',
  'comfort': 'Comfort',
});

// Ticked ingredients are session state on purpose: she is ticking them off
// while the pan is on, not keeping a shopping list. Nothing here is written to
// storage, so a fresh open starts clean.
const ticked = new Map();

/* ------------------------------------------------------------------ strings */

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

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
  return used ? out : `${Object.values(values).join(' ')} ${out}`.trim();
}

function filterLabel(id) {
  return str(`bites.filters.${id}`, FILTER_LABELS[id] || id);
}

function tagLabel(tag) {
  return str(`bites.tags.${tag}`, TAG_LABELS[tag] || tag);
}

/* --------------------------------------------------------------------- data */

function bundleOf(ctx) {
  if (ctx && ctx.data) return ctx.data;
  try {
    return getData();
  } catch {
    return null;
  }
}

function mealsOf(ctx) {
  const data = bundleOf(ctx);
  return Array.isArray(data && data.meals) ? data.meals : [];
}

function swapsOf(ctx) {
  const data = bundleOf(ctx);
  return Array.isArray(data && data.swaps) ? data.swaps : [];
}

/* ------------------------------------------------------------------ motion */

/** The list-row entrance from the motion table: first rows only, transform and
 *  opacity, and a plain fade when reduced motion is on. */
function stagger(nodes) {
  const reduced = prefersReducedMotion();
  nodes.slice(0, STAGGER_ROWS).forEach((node, index) => {
    if (typeof node.animate !== 'function') return;
    if (reduced) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: EASE_OUT });
      return;
    }
    node.animate([
      { opacity: 0, transform: `translateY(${DRIFT_PX}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: ROW_MS, delay: index * STAGGER_MS, easing: EASE_OUT, fill: 'backwards' });
  });
}

/* ------------------------------------------------------------- meal sheet */

function tickKey(meal) {
  return String(meal.id || meal.name || '');
}

function ingredientButton(meal, text, index) {
  const key = tickKey(meal);
  const done = ticked.get(key);
  const on = !!(done && done.has(index));

  const button = el('button', {
    class: on ? 'ingredient is-done' : 'ingredient',
    type: 'button',
    aria: { pressed: String(on) },
  }, [el('span', {}, text)]);
  button.insertAdjacentHTML('afterbegin', icon('circle-check', { size: 20 }));

  button.addEventListener('click', () => {
    const set = ticked.get(key) || new Set();
    const next = !set.has(index);
    if (next) set.add(index);
    else set.delete(index);
    ticked.set(key, set);
    button.classList.toggle('is-done', next);
    button.setAttribute('aria-pressed', String(next));
  });

  return button;
}

function buildMeal(content, meal) {
  const name = String(meal.name || '').trim();
  const emoji = String(meal.emoji || '').trim();
  const pun = String(meal.punLine || '').trim();
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const steps = Array.isArray(meal.steps) ? meal.steps : (meal.steps ? [meal.steps] : []);
  const tags = Array.isArray(meal.tags) ? meal.tags : [];

  if (emoji) content.appendChild(el('div', { class: 'verdict__emoji', aria: { hidden: 'true' } }, emoji));
  content.appendChild(el('h2', { class: 'verdict__name' }, name));
  const dish = String(meal.dish || '').trim();
  if (dish) content.appendChild(el('p', { class: 'bite__dish' }, dish));
  if (pun) content.appendChild(el('p', { class: 'bite__pun' }, pun));

  if (tags.length) {
    content.appendChild(el('span', { class: 'tags' }, tags.map(
      (tag) => el('span', { class: 'tag' }, tagLabel(tag)),
    )));
  }

  if (ingredients.length) {
    content.appendChild(el('h3', { class: 'group-title' }, str('bites.ingredientsTitle', 'What you need')));
    content.appendChild(el('p', { class: 'caption' }, str(
      'bites.tickHint',
      'Tap an ingredient to tick it off while you cook.',
    )));
    content.appendChild(el('ul', { class: 'stack' }, ingredients.map(
      (text, index) => el('li', {}, [ingredientButton(meal, String(text), index)]),
    )));
  }

  if (steps.length) {
    content.appendChild(el('h3', { class: 'group-title' }, str('bites.stepsTitle', 'How it goes')));
    content.appendChild(el('ol', { class: 'steps' }, steps.map(
      (text) => el('li', {}, String(text)),
    )));
  }
}

/**
 * Exported as well as used here, because the shared view context hands an
 * `openMealSheet` to every view and this module owns the meals.
 */
export function openMealSheet(meal, { fromEl } = {}) {
  if (!meal || typeof meal !== 'object') return null;
  return openSheet({
    id: `meal-${meal.id || 'bite'}`,
    label: String(meal.name || ''),
    fromEl,
    build: (content) => buildMeal(content, meal),
  });
}

/* ------------------------------------------------------------------ cards */

function mealCard(meal, open) {
  const emoji = String(meal.emoji || '').trim();
  const tags = Array.isArray(meal.tags) ? meal.tags.slice(0, 3) : [];

  // The pun name is the personality; the dish line says what the food IS. The
  // long punLine joke lives in the opened sheet, not here, so the card reads
  // at a glance: Grate Expectations. Cheddar, crackers and cherry toms.
  const card = el('button', { class: 'bite', type: 'button' }, [
    emoji ? el('span', { class: 'bite__emoji', aria: { hidden: 'true' } }, emoji) : null,
    el('span', { class: 'bite__name' }, String(meal.name || '')),
    meal.dish ? el('span', { class: 'bite__dish' }, String(meal.dish)) : null,
    tags.length
      ? el('span', { class: 'tags' }, tags.map((tag) => el('span', { class: 'tag' }, tagLabel(tag))))
      : null,
  ]);

  card.addEventListener('click', () => open(meal, card));
  return card;
}

function swapsSection(swaps) {
  if (!swaps.length) return null;

  const rows = swaps
    .filter((row) => row && row.craving && row.swap)
    .map((row) => el('div', { class: 'swap-row' }, [
      el('strong', {}, String(row.craving)),
      el('span', { aria: { hidden: 'true' } }, ' → '),
      el('span', { class: 'sr-only' }, ` ${str('bites.swapWord', 'swap for')} `),
      el('span', {}, String(row.swap)),
    ]));

  return el('section', { class: 'swaps' }, [
    el('h2', { class: 'group-title' }, str('bites.swapsTitle', 'Craving something benched?')),
    ...rows,
  ]);
}

/* ------------------------------------------------------------------- view */

function matches(meal, selected) {
  const types = [];
  const tags = [];
  for (const id of selected) {
    const filter = FILTERS.find((entry) => entry.id === id);
    if (!filter) continue;
    if (filter.type) types.push(filter.type);
    if (filter.tag) tags.push(filter.tag);
  }

  // Tags AND together, which is the point of multi-select. The two type chips
  // are the one exception: they OR, so picking both reads as "snacks and
  // meals" rather than dead-ending on an impossible combination.
  if (types.length && !types.includes(meal.type)) return false;
  const mealTags = Array.isArray(meal.tags) ? meal.tags : [];
  return tags.every((tag) => mealTags.includes(tag));
}

export function createBitesView(ctx = {}) {
  const root = document.getElementById(`view-${VIEW_ID}`)
    || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = root.querySelector('.view__inner');
  if (!inner) {
    inner = el('div', { class: 'view__inner' });
    root.appendChild(inner);
  }

  const open = (meal, fromEl) => {
    const opener = typeof ctx.openMealSheet === 'function' ? ctx.openMealSheet : openMealSheet;
    opener(meal, { fromEl });
  };

  const selected = new Set();
  const chipNodes = new Map();
  const list = el('div', { class: 'stack' });
  const count = el('p', { class: 'sr-only', role: 'status' });
  let shown = 0;

  const syncChips = () => {
    for (const [id, node] of chipNodes) {
      const on = id === 'all' ? selected.size === 0 : selected.has(id);
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    }
  };

  const renderList = (animateRows) => {
    const meals = mealsOf(ctx).filter((meal) => meal && matches(meal, selected));
    shown = meals.length;

    if (!meals.length) {
      const clear = el('button', { class: 'btn btn--primary', type: 'button' }, [
        str('bites.clearFilters', 'Clear filters'),
      ]);
      clear.addEventListener('click', () => {
        selected.clear();
        syncChips();
        renderList(true);
      });
      list.replaceChildren(el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title' }, str('bites.emptyTitle', 'Nothing matches that combination yet.')),
        el('p', {}, str('bites.empty', 'Nothing matches those filters. Take one off and have another look.')),
        clear,
      ]));
      count.textContent = fill(str('bites.count', '{n} bites'), { n: 0 });
      return;
    }

    const cards = meals.map((meal) => mealCard(meal, open));
    list.replaceChildren(...cards);
    count.textContent = fill(str('bites.count', '{n} bites'), { n: cards.length });
    if (animateRows) stagger(cards);
  };

  const chips = el('div', {
    class: 'chips',
    role: 'group',
    aria: { label: str('bites.filterLabel', 'Filter bites') },
  }, FILTERS.map((filter) => {
    const chip = el('button', {
      class: 'chip',
      type: 'button',
      aria: { pressed: 'false' },
    }, [filterLabel(filter.id)]);

    chip.addEventListener('click', () => {
      if (filter.id === 'all') selected.clear();
      else if (selected.has(filter.id)) selected.delete(filter.id);
      else selected.add(filter.id);
      syncChips();
      renderList(true);
    });

    chipNodes.set(filter.id, chip);
    return chip;
  }));

  // Re-runnable: the chips, the counter and the list are long-lived nodes, so
  // this only ever re-stitches the page around them.
  const render = (animateRows) => {
    inner.replaceChildren(
      el('h1', { class: 'group-title' }, str('bites.title', 'Bump Bites')),
      el('p', { class: 'caption' }, str('bites.sub', 'Every one of these is green, or yellow inside its limit.')),
      chips,
      count,
      list,
    );
    const swaps = swapsSection(swapsOf(ctx));
    if (swaps) inner.appendChild(swaps);
    syncChips();
    renderList(animateRows);
  };

  render(false);

  return {
    id: VIEW_ID,
    el: root,
    onEnter() {
      // Data can land after the view is built on a cold, slow first load, so an
      // empty screen gets one more go rather than staying empty until she taps
      // a filter.
      if (shown === 0 && mealsOf(ctx).length) render(false);
    },
    onLeave() {},
  };
}
