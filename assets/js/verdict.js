// The verdict sheet: the hero moment. Anatomy is build spec 5.2, top to bottom,
// and the order is load bearing. The why sits directly under the sticker so the
// accuracy payload is never the thing that scrolled away.

import { CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { el, pick, prefersReducedMotion, store } from './util.js';
import { icon } from './icons.js';
import { openSheet, isSheetOpen } from './sheet.js';
import { foodById, sourceLabel } from './data.js';
import { TIERS, stickerHtml, playStamp } from './sticker.js';

// sheet.js opens over 380ms and then fires sheet:opened. A sheet that merely
// replaces another one never fires it, and only crossfades its body, so that
// path gets its own shorter wait.
const OPEN_SETTLE_MS = 420;
const SWAP_SETTLE_MS = 160;

const CALLOUT_MS = 240;
// Just behind the stamp, so the fix arrives as a second beat rather than
// competing with it. The motion spec pins this at 100ms after the stamp lands:
// on a "not now" verdict this callout is the kindness, and it needs to arrive
// while she is still reading the answer.
const CALLOUT_DELAY_MS = 100;

const VARIANT_FADE_MS = 140;
const HEART_MS = 500;
const BURST_MS = 500;
const BURST_COUNT = 4;
const BURST_PX = 6;
const BURST_MIN_PX = 18;
const BURST_SPREAD_PX = 14;
const BURST_FROM_DEG = 200;
const BURST_TO_DEG = 340;

const FAVS_KEY = 'favs';

// Mirrors --ease-out and --spring in the token block.
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';

let uid = 0;

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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** "Make it green" and "Craving fix" are prefixes, so they earn their colon. */
function labelled(label) {
  const clean = text(label);
  if (!clean) return '';
  return /[:.!?]$/.test(clean) ? `${clean} ` : `${clean}: `;
}

function tierKeyOf(tier) {
  const key = String(tier === null || tier === undefined ? '' : tier).toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(TIERS, key) ? key : 'depends';
}

/**
 * Same food, same opener, every time: a stable hash of the id, so the app reads
 * as if someone wrote it rather than as if it rolled dice.
 */
function openerFor(food, key) {
  // The strings file may key these by tier (green) or by the sticker's class
  // word (go). Both spellings resolve, neither is required.
  const byTier = strList(`verdictOpeners.${key}`);
  const openers = byTier.length ? byTier : strList(`verdictOpeners.${TIERS[key].cls}`);
  return pick(openers, food.id) || '';
}

/* --------------------------------------------------------------- favourites */

function favIds() {
  const saved = store.get(FAVS_KEY, []);
  return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
}

function isFav(id) {
  return favIds().includes(id);
}

function toggleFav(id) {
  const ids = favIds();
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1);
  else ids.push(id);
  store.set(FAVS_KEY, ids);
  return at < 0;
}

function favLabel(on) {
  return on
    ? str('verdict.unfavourite', 'Remove from favourites')
    : str('verdict.favourite', 'Save to favourites');
}

function ensurePositioned(node) {
  try {
    if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
  } catch {
    // No layout yet. The stylesheet's own positioning is the normal path.
  }
}

/** The 4-particle butter burst from the motion table, transform and opacity only. */
function burst(host) {
  ensurePositioned(host);

  const layer = el('span', {
    class: 'confetti',
    aria: { hidden: 'true' },
    style: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0',
      height: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    },
  });

  const step = (BURST_TO_DEG - BURST_FROM_DEG) / BURST_COUNT;

  for (let i = 0; i < BURST_COUNT; i += 1) {
    const bit = el('span', {
      class: 'confetti__bit',
      style: {
        position: 'absolute',
        left: `${-BURST_PX / 2}px`,
        top: `${-BURST_PX / 2}px`,
        width: `${BURST_PX}px`,
        height: `${BURST_PX}px`,
        borderRadius: '50%',
        background: 'var(--butter)',
        willChange: 'transform, opacity',
      },
    });
    layer.appendChild(bit);

    // Degrees clockwise from the x-axis with y growing downward, so this fans
    // the particles up and out of the heart.
    const rad = ((BURST_FROM_DEG + (i + 0.5) * step) * Math.PI) / 180;
    const dist = BURST_MIN_PX + Math.random() * BURST_SPREAD_PX;

    if (typeof bit.animate === 'function') {
      bit.animate([
        { transform: 'translate(0px, 0px) scale(.6)', opacity: 1 },
        { transform: `translate(${(Math.cos(rad) * dist).toFixed(1)}px, ${(Math.sin(rad) * dist).toFixed(1)}px) scale(1)`, opacity: 0 },
      ], { duration: BURST_MS, easing: EASE_OUT, fill: 'forwards' });
    }
  }

  host.appendChild(layer);
  setTimeout(() => layer.remove(), BURST_MS + 80);
}

function celebrateFav(button) {
  if (prefersReducedMotion()) return;

  // The svg carries the pop, not the button: the button already owns an
  // :active scale, and two transforms on one node fight each other.
  const heart = button.querySelector('svg') || button;
  if (typeof heart.animate === 'function') {
    heart.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
      { duration: HEART_MS, easing: SPRING },
    );
  }
  burst(button);
}

function favButton(food) {
  const on = isFav(food.id);
  const button = el('button', {
    class: 'sheet__fav',
    type: 'button',
    aria: { pressed: String(on), label: favLabel(on) },
    html: icon('heart', { size: 24 }),
  });

  button.addEventListener('click', () => {
    const next = toggleFav(food.id);
    button.setAttribute('aria-pressed', String(next));
    button.setAttribute('aria-label', favLabel(next));
    if (next) celebrateFav(button);
  });

  return button;
}

/* -------------------------------------------------------------- sheet parts */

function calloutEl(message) {
  return el('div', { class: 'callout callout--green' }, [
    el('span', { html: icon('sparkles', { size: 20, cls: 'callout__icon' }) }),
    el('p', {}, [
      el('strong', {}, labelled(str('verdict.makeItGreen', 'Make it green'))),
      message,
    ]),
  ]);
}

function swapEl(message) {
  return el('p', { class: 'swap' }, [
    el('strong', {}, labelled(str('verdict.swap', 'Craving fix'))),
    message,
  ]);
}

/**
 * Pregnancy nutrient chips. A closed set with a fixed order, so every sheet
 * reads the same way and the validator can hold the line. The level word is
 * always written in the chip: the berry colour reinforces, it never carries
 * the meaning alone.
 */
const NUTRIENTS = Object.freeze([
  ['folate', 'Folate'],
  ['iron', 'Iron'],
  ['calcium', 'Calcium'],
  ['protein', 'Protein'],
  ['omega3', 'Omega-3'],
  ['iodine', 'Iodine'],
  ['fibre', 'Fibre'],
]);

const NUTRIENT_LEVELS = Object.freeze({ high: 'high', med: 'medium', low: 'low' });

function nutrientsEl(nutrients) {
  if (!nutrients || typeof nutrients !== 'object') return null;

  const chips = [];
  for (const [key, label] of NUTRIENTS) {
    const level = NUTRIENT_LEVELS[nutrients[key]];
    if (!level) continue;
    chips.push(el('span', { class: `nutrient nutrient--${nutrients[key]}` }, [
      el('strong', {}, label),
      ` ${level}`,
    ]));
  }
  if (!chips.length) return null;

  return el('div', { class: 'nutrients' }, [
    el('p', { class: 'nutrients__title' }, str('verdict.nutrientsHeading', 'The good stuff in it')),
    el('div', { class: 'nutrients__row' }, chips),
  ]);
}

/**
 * The per-serve nutrition panel. Australian label order, so it reads the way
 * the back of a packet does, with saturated fat and sugars indented under
 * their parents rather than pretending to be separate lines.
 *
 * Every number is a typical-serve estimate, and the panel says so out loud.
 * Someone counting carbs for gestational diabetes needs to know this is a
 * guide rather than a label reading, and burying that would be a quiet lie.
 */
/**
 * Six tiles rather than a column of label rows.
 *
 * A nutrition panel is built to be audited line by line, which is the wrong
 * shape for someone deciding in a cafe queue. The same numbers as tiles can be
 * taken in at a glance, and the two that are part of a bigger number (saturated
 * fat, sugars) ride inside their parent tile so nothing is lost and nothing
 * pretends to be its own headline.
 */
const NUTRITION_TILES = Object.freeze([
  { key: 'kj', label: 'Energy', unit: 'kJ', hero: true },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g', sub: { key: 'sugars', label: 'sugars' } },
  { key: 'fat', label: 'Fat', unit: 'g', sub: { key: 'satFat', label: 'sat fat' } },
  { key: 'fibre', label: 'Fibre', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
]);

/** Drops the trailing zero so 5.0 reads as 5, and groups thousands in energy. */
function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  // 1,580 is read at a glance. 1580 has to be counted.
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function nutritionEl(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return null;
  if (typeof nutrition.kj !== 'number' || !Number.isFinite(nutrition.kj)) return null;

  const tiles = [];
  for (const tile of NUTRITION_TILES) {
    const value = amount(nutrition[tile.key]);
    if (value === null) continue;

    const parts = [
      el('span', { class: 'ntile__value' }, [
        value,
        el('span', { class: 'ntile__unit' }, tile.unit),
      ]),
      el('span', { class: 'ntile__label' }, tile.label),
    ];

    // Energy carries calories as its second line, because plenty of us still
    // think in them even though the label standard here is kilojoules.
    if (tile.hero) {
      parts.push(el('span', { class: 'ntile__sub' }, `${amount(Math.round(nutrition.kj / 4.184))} Cal`));
    } else if (tile.sub) {
      const subValue = amount(nutrition[tile.sub.key]);
      if (subValue !== null) {
        parts.push(el('span', { class: 'ntile__sub' }, `${subValue}g ${tile.sub.label}`));
      }
    }

    tiles.push(el('div', { class: `ntile${tile.hero ? ' ntile--hero' : ''}` }, parts));
  }
  if (!tiles.length) return null;

  const serve = text(nutrition.serve);

  return el('section', { class: 'nutrition' }, [
    el('div', { class: 'nutrition__head' }, [
      el('h3', { class: 'nutrition__title' }, str('verdict.nutritionHeading', "What's in it")),
      serve ? el('p', { class: 'nutrition__serve' }, fill(
        str('verdict.nutritionServe', 'Per {serve}'),
        { serve },
      )) : null,
    ].filter(Boolean)),
    el('div', { class: 'nutrition__grid' }, tiles),
    el('p', { class: 'nutrition__note' }, str(
      'verdict.nutritionNote',
      'Typical serve, averaged from Australian food data. A guide for interest, not a label reading, so check the packet if you are counting closely.',
    )),
  ]);
}

/**
 * The honest 50-50 panel. Some foods are genuine judgement calls, and Ryan's
 * rule for those is transparency over false confidence: show what each source
 * actually says, side by side, and let the tier carry the stricter call.
 */
function splitEl(split) {
  if (!split || typeof split !== 'object') return null;
  const positions = (Array.isArray(split.positions) ? split.positions : [])
    .filter((pos) => pos && text(pos.label) && text(pos.says));
  if (positions.length < 2) return null;

  const wrap = el('div', { class: 'split', role: 'note' }, [
    el('p', { class: 'split__note' }, [
      el('strong', {}, labelled(str('verdict.splitHeading', "It's a 50-50"))),
      text(split.note),
    ]),
  ]);

  for (const pos of positions) {
    wrap.appendChild(el('p', { class: 'split__position' }, [
      el('strong', { class: 'split__who' }, labelled(text(pos.label))),
      text(pos.says),
    ]));
  }
  return wrap;
}

function whyEl(food, key) {
  const why = text(food.why)
    || (key === 'depends' ? str('verdict.dependsLead', "Depends how it's served:") : '');

  // A why that already ends in a colon is a lead-in, and putting an opener in
  // front of one reads like a stutter.
  const leadIn = /:$/.test(why);
  const opener = leadIn ? '' : openerFor(food, key);

  if (!opener) return el('p', { class: 'verdict__why' }, why);
  return el('p', { class: 'verdict__why' }, [
    el('strong', {}, `${opener} `),
    why,
  ]);
}

function toggleVariant(button, panel) {
  const on = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!on));
  panel.hidden = on;
  // Belt and braces: a class rule that sets display would out-specify the
  // hidden attribute, and a "collapsed" row that is still visible is a lie.
  panel.style.display = on ? 'none' : '';

  if (on || prefersReducedMotion() || typeof panel.animate !== 'function') return;
  panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VARIANT_FADE_MS, easing: EASE_OUT });
}

function variantRow(variant, wrap) {
  uid += 1;
  const panelId = `ba-variant-${uid}`;

  const panel = el('div', {
    class: 'variant__why',
    id: panelId,
    hidden: true,
    style: { display: 'none' },
  });
  const why = text(variant.why);
  if (why) panel.appendChild(el('p', {}, why));

  // A red variant carries its own way out, same rule as a red food.
  const green = text(variant.makeItGreen);
  if (green) panel.appendChild(calloutEl(green));
  const swap = text(variant.swap);
  if (swap) panel.appendChild(swapEl(swap));

  const button = el('button', {
    class: 'variant',
    type: 'button',
    aria: { expanded: 'false', controls: panelId },
  }, [el('span', { class: 'variant__label' }, text(variant.label))]);
  // The mini sticker is unlabelled on purpose: the row already says the label,
  // so the button reads as "Smoked or raw, not now".
  button.insertAdjacentHTML('beforeend', stickerHtml(variant.tier, { mini: true }));
  button.addEventListener('click', () => toggleVariant(button, panel));

  wrap.append(button, panel);
}

function variantsEl(variants) {
  const wrap = el('div', { class: 'variants' });
  for (const variant of variants) {
    if (variant && typeof variant === 'object') variantRow(variant, wrap);
  }
  return wrap;
}

/** Same slot filler the other views carry, so a string can move between them. */
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
  return used ? out : `${out} ${Object.values(values).join(' ')}`.trim();
}

function checkedText() {
  const date = text(CONFIG && CONFIG.reviewedLabel);
  const template = str('verdict.checked', 'Checked {date}');
  return template.includes('{date}')
    ? template.replace('{date}', date)
    : `${template} ${date}`.trim();
}

function appendFooter(content, food) {
  const keys = (Array.isArray(food.sources) ? food.sources : []).filter(Boolean);
  if (keys.length) {
    content.appendChild(el('div', { class: 'sources' }, [
      el('span', { class: 'sr-only' }, `${str('verdict.sources', 'Sources')}: `),
      ...keys.map((key) => el('span', { class: 'source-chip' }, sourceLabel(key))),
    ]));
  }

  // Honesty about the pipeline: rows still awaiting Ryan's source sign-off say
  // so, rather than wearing the same "checked" clothes as the verified ones.
  const flags = Array.isArray(food.flags) ? food.flags : [];
  if (flags.includes('confirm')) {
    content.appendChild(el('p', { class: 'caption' }, str(
      'verdict.flagConfirm',
      'Ryan is double-checking this one against the source.',
    )));
  }

  content.appendChild(el('p', { class: 'checked' }, checkedText()));
  content.appendChild(el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    on: { click: () => openHowWeDecideSheet() },
  }, str('verdict.howWeDecide', 'How we decide')));
}

function buildVerdict(content, food, refs) {
  const key = tierKeyOf(food.tier);

  content.appendChild(favButton(food));

  const emoji = text(food.emoji);
  if (emoji) content.appendChild(el('div', { class: 'verdict__emoji', aria: { hidden: 'true' } }, emoji));
  content.appendChild(el('h2', { class: 'verdict__name' }, text(food.name)));

  content.insertAdjacentHTML('beforeend', stickerHtml(key, { name: text(food.name) }));
  refs.sticker = content.lastElementChild;

  content.appendChild(whyEl(food, key));

  const split = splitEl(food.split);
  if (split) content.appendChild(split);

  const green = text(food.makeItGreen);
  if (green) {
    refs.callout = calloutEl(green);
    content.appendChild(refs.callout);
  }

  const swap = text(food.swap);
  if (swap) content.appendChild(swapEl(swap));

  const variants = Array.isArray(food.variants) ? food.variants : [];
  if (variants.length) content.appendChild(variantsEl(variants));

  // Nutrition sits below every safety element on purpose: what is in it for
  // her is worth knowing, but never allowed to upstage whether she can eat it.
  const nutrients = nutrientsEl(food.nutrients);
  if (nutrients) content.appendChild(nutrients);

  const nutrition = nutritionEl(food.nutrition);
  if (nutrition) content.appendChild(nutrition);

  appendFooter(content, food);
}

/* --------------------------------------------------------------------- API */

function whenSettled(sheetEl, waitMs, fn) {
  if (!sheetEl) {
    setTimeout(fn, waitMs);
    return;
  }

  let done = false;
  let timer = 0;

  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    sheetEl.removeEventListener('sheet:opened', run);
    fn();
  };

  sheetEl.addEventListener('sheet:opened', run);
  timer = setTimeout(run, waitMs);
}

function fadeIn(node) {
  if (!node || prefersReducedMotion() || typeof node.animate !== 'function') return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: CALLOUT_MS,
    delay: CALLOUT_DELAY_MS,
    easing: EASE_OUT,
    fill: 'backwards',
  });
}

function resolveFood(food) {
  if (food && typeof food === 'object') return food;
  if (typeof food !== 'string' || !food) return null;
  try {
    return foodById(food);
  } catch {
    return null;   // data has not loaded, and a blank sheet helps nobody
  }
}

export function openFoodSheet(food, { fromEl } = {}) {
  const entry = resolveFood(food);
  if (!entry) return null;

  const refs = { sticker: null, callout: null };
  const wasOpen = isSheetOpen();

  const sheetEl = openSheet({
    id: `food-${entry.id}`,
    label: text(entry.name),
    fromEl,
    build: (content) => buildVerdict(content, entry, refs),
  });

  // The stamp waits for the sheet to settle, so her eye lands on the sticker
  // instead of chasing it up the screen.
  whenSettled(sheetEl, wasOpen ? SWAP_SETTLE_MS : OPEN_SETTLE_MS, () => {
    if (!refs.sticker || !refs.sticker.isConnected) return;
    playStamp(refs.sticker, entry.tier);
    fadeIn(refs.callout);
  });

  return sheetEl;
}

/**
 * The quiet link in every verdict footer. Exported as well so the More view can
 * open the same sheet rather than writing a second copy of it.
 */
export function openHowWeDecideSheet({ fromEl } = {}) {
  const title = str('howWeDecide.title', 'How we decide');
  const body = strList('howWeDecide.body');
  const single = str('howWeDecide.body', '');
  const paragraphs = body.length ? body : (single ? [single] : []);

  return openSheet({
    id: 'how-we-decide',
    label: title,
    fromEl,
    build: (content) => {
      content.appendChild(el('h2', { class: 'verdict__name' }, title));
      for (const paragraph of paragraphs) content.appendChild(el('p', {}, paragraph));
    },
  });
}
