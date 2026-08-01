// More: the drawer everything that is not a search lives in.
//
// Six rows, each opening a sheet. The rows stay deliberately plain, because the
// one screen behind them that matters at 3am is "Oops, I ate it", and that one
// is built to be the calmest thing in the app: no rose surfaces, no motion, no
// jokes, bigger body text, and a phone number she can hit with a thumb.

import { CONFIG } from '../config.js';
import { STRINGS } from '../strings.js';
import { el } from '../util.js';
import { icon } from '../icons.js';
import { openSheet } from '../sheet.js';
import { getData } from '../data.js';
import { stickerHtml } from '../sticker.js';
import { openHowWeDecideSheet } from '../verdict.js';
import { openCaffeineSheet, openFishSheet } from '../trackers.js';

const VIEW_ID = 'more';

const ROW_LABELS = Object.freeze({
  cheatsheets: 'Cheat sheets',
  caffeine: 'Caffeine today',
  fish: 'Fish tracker',
  oops: 'Oops, I ate it',
  howWeDecide: 'How we decide',
  about: 'About & sources',
});

// Deliberately plain, deliberately pun-free. Build spec 5.6: zero "you should
// have known" energy, and "should" is a banned word in this app's copy anyway.
const OOPS_STEPS = Object.freeze([
  'A single exposure very rarely causes harm. One meal is a small risk, not a disaster.',
  'Over the next few weeks, keep an eye out for a fever, flu-like aches, or vomiting and diarrhoea.',
  'If you feel unwell, or you are simply not sure, ring your midwife or GP. This is exactly what they are there for.',
  'If you want to talk it through right now, the lines below are open and free.',
]);

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

/* --------------------------------------------------------------------- data */

function bundleOf(ctx) {
  if (ctx && ctx.data) return ctx.data;
  try {
    return getData();
  } catch {
    return null;
  }
}

function sheetsOf(ctx) {
  const data = bundleOf(ctx);
  return Array.isArray(data && data.sheets) ? data.sheets : [];
}

function sourcesOf(ctx) {
  const data = bundleOf(ctx);
  const map = data && data.sources;
  return map && typeof map === 'object' ? map : {};
}

/* -------------------------------------------------------------------- rows */

function rowButton(label, onClick) {
  const row = el('button', { class: 'row', type: 'button' }, [
    el('span', { class: 'row__label' }, label),
  ]);
  row.insertAdjacentHTML('beforeend', `<span class="row__chev">${icon('chevron-right', { size: 20 })}</span>`);
  row.addEventListener('click', () => onClick(row));
  return row;
}

/* ------------------------------------------------------------- cheat sheets */

function buildCheatSheet(content, sheet, ctx) {
  const name = String(sheet.name || '').trim();
  const emoji = String(sheet.emoji || '').trim();
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const asks = Array.isArray(sheet.asks) ? sheet.asks : [];

  if (emoji) content.appendChild(el('div', { class: 'verdict__emoji', aria: { hidden: 'true' } }, emoji));
  content.appendChild(el('h2', { class: 'verdict__name' }, name));
  if (sheet.intro) content.appendChild(el('p', {}, String(sheet.intro)));

  for (const row of rows) {
    if (!row || !row.text) continue;
    const line = el('div', { class: 'dish' });
    // Sticker first, then the sentence: tier as colour plus icon plus word,
    // never one of the three on its own.
    line.insertAdjacentHTML('beforeend', stickerHtml(row.tier, { mini: true }));
    line.appendChild(el('p', { class: 'dish__why' }, String(row.text)));
    content.appendChild(line);
  }

  if (asks.length) {
    content.appendChild(el('h3', { class: 'group-title' }, str(
      'cheatsheets.asks',
      'Magic questions for the staff',
    )));
    content.appendChild(el('ul', { class: 'asks' }, asks.map(
      (ask) => el('li', {}, String(ask)),
    )));
  }

  const back = el('button', { class: 'btn btn--ghost', type: 'button' }, [
    str('cheatsheets.back', 'All cheat sheets'),
  ]);
  back.addEventListener('click', () => openCheatSheetPicker(ctx));
  content.appendChild(back);
}

function openCheatSheetPicker(ctx, { fromEl } = {}) {
  const sheets = sheetsOf(ctx);
  const title = str('cheatsheets.title', 'Cheat sheets');

  return openSheet({
    id: 'cheatsheets',
    label: title,
    fromEl,
    build: (content) => {
      content.appendChild(el('h2', { class: 'verdict__name' }, title));
      content.appendChild(el('p', {}, str(
        'cheatsheets.intro',
        'One screen per spot, so you can order without a search.',
      )));

      if (!sheets.length) {
        content.appendChild(el('p', { class: 'caption' }, str(
          'cheatsheets.empty',
          'The cheat sheets have not loaded yet. Try again in a moment.',
        )));
        return;
      }

      content.appendChild(el('div', { class: 'rows' }, sheets.map((sheet) => {
        const emoji = String(sheet.emoji || '').trim();
        const label = emoji ? `${emoji} ${sheet.name || ''}`.trim() : String(sheet.name || '');
        return rowButton(label, () => openSheet({
          id: `cheatsheet-${sheet.id || 'sheet'}`,
          label: String(sheet.name || title),
          build: (body) => buildCheatSheet(body, sheet, ctx),
        }));
      })));
    },
  });
}

/* ---------------------------------------------------------- oops, I ate it */

function telHref(number) {
  const digits = String(number || '').replace(/[^0-9+]/g, '');
  return digits ? `tel:${digits}` : '';
}

function helplineButton(line) {
  const href = telHref(line.number);
  if (!href) return null;

  const name = String(line.name || '').trim();
  const display = String(line.display || line.number || '').trim();
  const label = fill(str('oops.call', 'Call {name} - {number}'), { name, number: display });

  const button = el('a', { class: 'callbtn', href }, [el('span', {}, label)]);
  button.insertAdjacentHTML('afterbegin', icon('phone', { size: 24 }));
  return button;
}

function buildOops(content) {
  const steps = strList('oops.steps');
  const lines = steps.length ? steps : OOPS_STEPS;
  const helplines = Array.isArray(CONFIG.helplines) ? CONFIG.helplines : [];

  // Everything sits inside .calm, which is what carries the 18/1.6 body text,
  // the fades-only motion rule and the no-rose surface rule for this screen.
  const calm = el('div', { class: 'calm' });

  calm.appendChild(el('h2', { class: 'verdict__name' }, str('oops.title', 'Oops, I ate it')));
  calm.appendChild(el('p', {}, str(
    'oops.lead',
    'First: breathe. One-off exposures very rarely cause harm.',
  )));

  calm.appendChild(el('ol', { class: 'steps' }, lines.map(
    (line) => el('li', { class: 'calm__step' }, line),
  )));

  if (helplines.length) {
    calm.appendChild(el('h3', { class: 'group-title' }, str('oops.helplines', 'Someone to talk it through with')));
    for (const line of helplines) {
      const button = helplineButton(line);
      if (button) calm.appendChild(button);
    }
  }

  const closing = str('oops.closing', '');
  if (closing) calm.appendChild(el('p', {}, closing));

  calm.appendChild(el('p', { class: 'disclaimer' }, str(
    'oops.disclaimer',
    'General information from Australian health sources, not medical advice. Your midwife, OB or GP knows your pregnancy.',
  )));

  content.appendChild(calm);
}

function openOopsSheet({ fromEl } = {}) {
  return openSheet({
    id: 'oops',
    label: str('oops.title', 'Oops, I ate it'),
    fromEl,
    build: buildOops,
  });
}

/* ---------------------------------------------------------- about & sources */

/** en-AU gives "31 Jul 2026". A source that never parses keeps its raw date. */
function formatApproved(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return raw;
  }
}

function sourceRow(source) {
  const name = String(source.name || source.label || '').trim();
  if (!name) return null;

  const approved = formatApproved(source.approved);
  const url = String(source.url || '').trim();
  const label = el('span', { class: 'row__label' }, [
    el('span', {}, name),
    approved ? el('span', { class: 'caption' }, fill(str('about.approved', 'Approved {date}'), { date: approved })) : null,
  ]);

  if (!/^https?:\/\//i.test(url)) return el('div', { class: 'row' }, [label]);

  // target=_blank keeps the installed PWA on screen: a source PDF opening in
  // place would swallow the app with no browser chrome to get back from.
  const row = el('a', { class: 'row', href: url, target: '_blank', rel: 'noopener' }, [label]);
  row.insertAdjacentHTML('beforeend', `<span class="row__chev">${icon('external-link', { size: 20 })}</span>`);
  return row;
}

function openAboutSheet(ctx, { fromEl } = {}) {
  const title = str('about.title', 'About & sources');
  const sources = sourcesOf(ctx);

  return openSheet({
    id: 'about',
    label: title,
    fromEl,
    build: (content) => {
      content.appendChild(el('h2', { class: 'verdict__name' }, title));

      const lead = str('about.lead', '');
      if (lead) content.appendChild(el('p', {}, lead));

      const rows = Object.values(sources).map(sourceRow).filter(Boolean);
      if (rows.length) {
        content.appendChild(el('h3', { class: 'group-title' }, str('about.sources', 'Where the answers come from')));
        content.appendChild(el('div', { class: 'rows' }, rows));
      }

      const checked = String((CONFIG && CONFIG.reviewedLabel) || '').trim();
      if (checked) {
        content.appendChild(el('p', { class: 'checked' }, fill(
          str('verdict.checked', 'Checked {date}'),
          { date: checked },
        )));
      }

      content.appendChild(el('p', { class: 'disclaimer' }, str(
        'about.disclaimer',
        'General information from Australian health sources, not medical advice. Always check with your midwife, OB or GP, especially with allergies or conditions like gestational diabetes.',
      )));

      const made = el('p', { class: 'caption' }, [
        el('span', {}, str('about.madeBy', 'Made with love by Ryan')),
      ]);
      made.insertAdjacentHTML('afterbegin', icon('heart', { size: 16 }));
      content.appendChild(made);
    },
  });
}

/* ------------------------------------------------------------------- view */

export function createMoreView(ctx = {}) {
  const root = document.getElementById(`view-${VIEW_ID}`)
    || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = root.querySelector('.view__inner');
  if (!inner) {
    inner = el('div', { class: 'view__inner' });
    root.appendChild(inner);
  }

  const label = (key) => str(`more.rows.${key}`, ROW_LABELS[key]);

  const rows = el('div', { class: 'rows' }, [
    rowButton(label('cheatsheets'), (fromEl) => openCheatSheetPicker(ctx, { fromEl })),
    rowButton(label('caffeine'), (fromEl) => openCaffeineSheet({ fromEl })),
    rowButton(label('fish'), (fromEl) => openFishSheet({ fromEl })),
    rowButton(label('oops'), (fromEl) => openOopsSheet({ fromEl })),
    rowButton(label('howWeDecide'), (fromEl) => openHowWeDecideSheet({ fromEl })),
    rowButton(label('about'), (fromEl) => openAboutSheet(ctx, { fromEl })),
  ]);

  inner.replaceChildren(
    el('h1', { class: 'group-title' }, str('more.title', 'More')),
    rows,
  );

  return {
    id: VIEW_ID,
    el: root,
    onEnter() {},
    onLeave() {},
  };
}
