// The answer sheet. The whole app points here.
//
// Anatomy, top to bottom, and the order is load bearing: emoji, name, sticker,
// then the answer. On a CALL SOMEONE entry the phone button sits directly under
// the sticker, above everything else, because somebody reading that screen is
// frightened and should not have to scroll to find the number.

import { CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { el, pick, prefersReducedMotion, store } from './util.js';
import { icon } from './icons.js';
import { openSheet, isSheetOpen } from './sheet.js';
import { entryById, howtoById_, sourceLabel, sourceById } from './data.js';
import { TIERS, stickerHtml, playStamp } from './sticker.js';

const OPEN_SETTLE_MS = 420;
const SWAP_SETTLE_MS = 160;
const SAVED_KEY = 'saved';

let onOpenHowto = null;

/** Wired by app.js so this sheet never has to import a view. */
export function setHowtoOpener(fn) {
  onOpenHowto = typeof fn === 'function' ? fn : null;
}

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
  return Array.isArray(node) ? node.filter((s) => typeof s === 'string' && s.trim()) : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tierKeyOf(tier) {
  const key = String(tier || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(TIERS, key) ? key : 'depends';
}

/* --------------------------------------------------------------- favourites */

function savedIds() {
  const list = store.get(SAVED_KEY, []);
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}

function toggleSaved(id) {
  const ids = savedIds();
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1); else ids.push(id);
  store.set(SAVED_KEY, ids);
  return at < 0;
}

function savedLabel(on) {
  return on ? str('answer.unfavourite', 'Remove from saved') : str('answer.favourite', 'Save this one');
}

function saveButton(entry) {
  const on = savedIds().includes(entry.id);
  const button = el('button', {
    class: 'sheet__fav',
    type: 'button',
    aria: { pressed: String(on), label: savedLabel(on) },
    html: icon('heart', { size: 24 }),
  });
  button.addEventListener('click', () => {
    const next = toggleSaved(entry.id);
    button.setAttribute('aria-pressed', String(next));
    button.setAttribute('aria-label', savedLabel(next));
  });
  return button;
}

/* -------------------------------------------------------------- the phone */

/**
 * Resolves who to ring into an actual number from config, so an entry can say
 * "Nurse line" and the app fills in whichever one is right for where they live.
 * An unmatched name still renders, just without a dial link: naming the service
 * is useful even when we do not hold its number.
 */
const CONTACT_FOR = Object.freeze({
  '000': ['000'],
  'GP': ['gp'],
  'MCH nurse': ['mch-nurse', 'mch-line'],
  'Nurse line': ['mch-line', 'nurse-on-call'],
  'ABA helpline': ['aba'],
  'Red Nose line': ['rednose'],
});

function contactFor(who) {
  const list = (CONFIG && CONFIG.contacts) || [];
  if (who === '000') return { label: 'Triple Zero', display: '000', number: '000', confirmed: true };
  for (const id of CONTACT_FOR[who] || []) {
    const found = list.find((c) => c.id === id && String(c.number || '').trim());
    if (found) return found;
  }
  return null;
}

function callEl(who) {
  const contact = contactFor(who);
  const label = contact ? (contact.label || who) : who;

  const inner = [
    el('span', { class: 'callbtn__icon', aria: { hidden: 'true' }, html: icon('phone', { size: 22 }) }),
    el('span', { class: 'callbtn__text' }, [
      el('span', { class: 'callbtn__who' }, label),
      contact && contact.display ? el('span', { class: 'callbtn__num' }, contact.display) : null,
    ].filter(Boolean)),
  ];

  const node = contact && contact.number
    ? el('a', { class: 'callbtn', href: `tel:${contact.number}`,
        aria: { label: `Ring ${label} on ${contact.display || contact.number}` } }, inner)
    : el('div', { class: 'callbtn callbtn--plain' }, inner);

  const wrap = el('div', { class: 'callwrap' }, [node]);
  // An unconfirmed number still shows, with the doubt attached rather than
  // hidden. Ringing it and finding it wrong is better than not having it.
  if (contact && contact.confirmed === false) {
    wrap.appendChild(el('p', { class: 'callwrap__note' },
      str('answer.unconfirmed', 'Worth ringing once in daylight to check this number still works.')));
  }
  return wrap;
}

/* --------------------------------------------------------------- the parts */

function whyEl(entry, key) {
  const why = text(entry.why);
  // A CALL SOMEONE answer gets no opener. The fact goes first.
  if (key === 'call') return el('p', { class: 'answer__why' }, why);

  const openers = strList(`openers.${key}`);
  const opener = pick(openers, entry.id) || '';
  if (!opener || /:$/.test(why)) return el('p', { class: 'answer__why' }, why);
  return el('p', { class: 'answer__why' }, [el('strong', {}, `${opener} `), why]);
}

function doEl(message) {
  return el('div', { class: 'callout callout--do' }, [
    el('span', { html: icon('sparkles', { size: 20, cls: 'callout__icon' }) }),
    el('p', {}, [el('strong', {}, `${str('answer.whatToDo', 'What to do')}: `), message]),
  ]);
}

function variantsEl(variants) {
  const wrap = el('div', { class: 'variants' });
  for (const variant of variants) {
    if (!variant || !text(variant.label)) continue;
    const key = tierKeyOf(variant.tier);
    const panel = el('div', { class: 'variant__panel', hidden: true }, [
      el('p', {}, text(variant.why)),
      text(variant.whatToDo) ? doEl(text(variant.whatToDo)) : null,
    ].filter(Boolean));

    const button = el('button', { class: 'variant', type: 'button', aria: { expanded: 'false' } }, [
      el('span', { class: 'variant__label' }, text(variant.label)),
      el('span', { class: 'variant__sticker', html: stickerHtml(key, { mini: true }) }),
    ]);
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!on));
      panel.hidden = on;
    });
    wrap.append(button, panel);
  }
  return wrap;
}

function howtoEl(id) {
  const howto = howtoById_(id);
  if (!howto) return null;
  const button = el('button', { class: 'row', type: 'button' }, [
    el('span', { class: 'row__emoji', aria: { hidden: 'true' } }, howto.emoji || ''),
    el('span', { class: 'row__label' }, howto.name),
    el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 20 }) }),
  ]);
  button.addEventListener('click', () => { if (onOpenHowto) onOpenHowto(id); });
  return el('div', { class: 'stack stack--tight' }, [
    el('h3', { class: 'caption' }, str('answer.relatedHowto', 'How to do it')),
    button,
  ]);
}

function footerEl(entry) {
  const parts = [];
  const keys = (Array.isArray(entry.sources) ? entry.sources : []).filter(Boolean);

  if (keys.length) {
    const chips = el('div', { class: 'sources' }, [
      el('span', { class: 'sr-only' }, `${str('answer.sources', 'Where this came from')}: `),
    ]);
    for (const key of keys) {
      const source = sourceById(key);
      const label = sourceLabel(key);
      chips.appendChild(source && source.url
        ? el('a', { class: 'source-chip', href: source.url, rel: 'noopener', target: '_blank' }, label)
        : el('span', { class: 'source-chip' }, label));
    }
    parts.push(chips);
  }

  // The link back to the page this was summarised from. It is what keeps the
  // app honest, and what keeps it current when the guidance moves.
  if (text(entry.link)) {
    parts.push(el('a', { class: 'btn btn--ghost', href: entry.link, rel: 'noopener', target: '_blank' },
      str('answer.readMore', 'Read the full page')));
  }

  const date = text(CONFIG && CONFIG.reviewedLabel);
  if (date) {
    parts.push(el('p', { class: 'checked' },
      str('answer.checked', 'Checked {date}').replace('{date}', date)));
  }
  return parts;
}

/* -------------------------------------------------------------- the sheet */

function build(content, entry) {
  const key = tierKeyOf(entry.tier);
  content.appendChild(saveButton(entry));

  if (text(entry.emoji)) {
    content.appendChild(el('div', { class: 'answer__emoji', aria: { hidden: 'true' } }, entry.emoji));
  }
  content.appendChild(el('h2', { class: 'answer__name' }, text(entry.name)));

  content.insertAdjacentHTML('beforeend', stickerHtml(key, { name: text(entry.name) }));
  const sticker = content.lastElementChild;

  // The number first on a call, before the explanation. Everything else can wait.
  if (key === 'call' && text(entry.whoToCall)) content.appendChild(callEl(text(entry.whoToCall)));

  content.appendChild(whyEl(entry, key));

  const variants = Array.isArray(entry.variants) ? entry.variants : [];
  if (variants.length) content.appendChild(variantsEl(variants));

  if (text(entry.whatToDo)) content.appendChild(doEl(text(entry.whatToDo)));

  const howto = howtoEl(entry.howto);
  if (howto) content.appendChild(howto);

  for (const part of footerEl(entry)) content.appendChild(part);

  return sticker;
}

export function openAnswerSheet(entry, { fromEl } = {}) {
  const record = typeof entry === 'string' ? entryById(entry) : entry;
  if (!record) return;

  const swapping = isSheetOpen();
  let sticker = null;

  openSheet({
    id: `answer-${record.id}`,
    label: record.name,
    fromEl,
    build: (content) => { sticker = build(content, record); },
  });

  // The stamp lands once the sheet has settled, so it reads as arriving rather
  // than as something that was already there.
  setTimeout(() => {
    if (sticker) playStamp(sticker, tierKeyOf(record.tier));
  }, swapping ? SWAP_SETTLE_MS : OPEN_SETTLE_MS);
}

export function openHowWeDecideSheet({ fromEl } = {}) {
  openSheet({
    id: 'how-we-decide',
    label: str('more.howWeDecide', 'How we decide'),
    fromEl,
    build: (content) => {
      content.appendChild(el('h2', { class: 'answer__name' }, str('more.howWeDecide', 'How we decide')));
      content.appendChild(el('p', {},
        'Every answer here is written from one of four Australian sources, in our own words, with a link back to the page it came from.'));
      const list = el('div', { class: 'rows' });
      for (const key of ['rcn', 'rednose', 'aba', 'rch', 'health']) {
        const source = sourceById(key);
        if (!source) continue;
        list.appendChild(el('a', { class: 'row', href: source.url, rel: 'noopener', target: '_blank' }, [
          el('span', { class: 'row__label' }, [
            el('strong', {}, source.name), source.role ? el('span', { class: 'caption' }, source.role) : null,
          ].filter(Boolean)),
        ]));
      }
      content.appendChild(list);
      content.appendChild(el('p', { class: 'disclaimer' }, str('more.disclaimer', '')));
    },
  });
}
