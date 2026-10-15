// More: everything that is not an answer, a week or a log.
// Settings lives here rather than in a fifth tab, because four is the ceiling
// on a phone and this is where you go when you are not in a hurry.

import { CONFIG } from '../config.js';
import { STRINGS } from '../strings.js';
import { $, el, store } from '../util.js';
import { icon } from '../icons.js';
import { getData, entryById, sourceById } from '../data.js';
import { stickerHtml } from '../sticker.js';
import * as sync from '../sync.js';
import * as notify from '../notify.js';
import {
  getDueDate, getBirthDate, setDueDate, setBirthDate, currentPosition, ageLabel,
} from '../timeline.js';

const VIEW_ID = 'more';

function readPath(source, path, fallback) {
  let node = source;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return node === null || node === undefined || node === '' ? fallback : node;
}

function since(ms) {
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (mins < 1) return 'a moment';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function createMoreView(ctx = {}) {
  const S = ctx.strings || STRINGS;
  const str = (path, fallback) => {
    const value = readPath(S, path, null);
    return typeof value === 'string' ? value : fallback;
  };

  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) { inner = el('div', { class: 'view__inner' }); root.appendChild(inner); }

  const openSheet = (opts) => { if (typeof ctx.openSheet === 'function') ctx.openSheet(opts); };

  /* ----------------------------------------------------------------- parts */

  function field(label, value, hint, onSave, type = 'text') {
    const input = el('input', { class: 'field__input', type, value: value || '' });
    input.addEventListener('change', () => {
      const ok = onSave(input.value);
      input.classList.toggle('is-bad', ok === false);
      // A refused value is left on screen so she can see and fix the typo,
      // rather than being silently blanked.
      if (ok !== false) input.classList.remove('is-bad');
    });
    return el('label', { class: 'field' }, [
      el('span', { class: 'field__label' }, label),
      input,
      hint ? el('span', { class: 'field__hint' }, hint) : null,
    ].filter(Boolean));
  }

  function toggle(label, on, onChange) {
    const button = el('button', {
      class: `toggle${on ? ' is-on' : ''}`, type: 'button', aria: { pressed: String(on) },
    }, [
      el('span', { class: 'toggle__label' }, label),
      el('span', { class: 'toggle__dot', aria: { hidden: 'true' } }),
    ]);
    button.addEventListener('click', async () => {
      const next = !(button.getAttribute('aria-pressed') === 'true');
      const allowed = await onChange(next);
      const settled = allowed === false ? false : next;
      button.classList.toggle('is-on', settled);
      button.setAttribute('aria-pressed', String(settled));
    });
    return button;
  }

  /* -------------------------------------------------------------- settings */

  function settingsSheet(fromEl) {
    openSheet({
      id: 'settings',
      label: str('settings.title', 'Settings'),
      fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'answer__name' }, str('settings.title', 'Settings')));

        // The dates. Everything in the app hangs off these two.
        const position = currentPosition();
        content.appendChild(el('section', { class: 'card' }, [
          el('h3', { class: 'card__title' }, str('settings.datesTitle', 'The dates')),
          position ? el('p', { class: 'caption' }, ageLabel(position)) : null,
          field(str('settings.dueDate', 'Due date'), getDueDate(), null,
            (v) => setDueDate(v), 'date'),
          field(str('settings.birthDate', 'Birth date'), getBirthDate(),
            str('settings.birthDateHint', ''), (v) => setBirthDate(v), 'date'),
          field(str('settings.babyName', 'What you call them'),
            store.get('babyName', '') || '', str('settings.babyNameHint', ''),
            (v) => { store.set('babyName', String(v || '').trim()); return true; }),
        ].filter(Boolean)));

        // Your people. Each number carries where it came from and whether it
        // has been rung, because an unchecked number is a liability at 2am.
        const people = el('div', { class: 'rows' });
        for (const contact of (CONFIG.contacts || [])) {
          const checked = Boolean(sync.get(`contact:${contact.id}:ok`, contact.confirmed));
          const row = el('div', { class: 'row row--static' }, [
            el('span', { class: 'row__label' }, [
              el('strong', {}, contact.label),
              el('span', { class: 'caption' }, [contact.display || 'Not set yet', contact.who].filter(Boolean).join(' · ')),
            ]),
          ]);
          if (String(contact.number || '').trim()) {
            row.appendChild(el('a', { class: 'row__call', href: `tel:${contact.number}`,
              aria: { label: `Ring ${contact.label}` }, html: icon('phone', { size: 18 }) }));
            row.appendChild(toggle(str('settings.confirmed', 'Checked'), checked,
              (next) => { sync.set(`contact:${contact.id}:ok`, next); return next; }));
          }
          people.appendChild(row);
        }
        content.appendChild(el('section', { class: 'card' }, [
          el('h3', { class: 'card__title' }, str('settings.peopleTitle', 'Your people')),
          el('p', { class: 'caption' }, str('settings.peopleHint', '')),
          people,
        ]));

        // Both phones. Off until a code is typed, and it says so.
        const pending = sync.pendingCount();
        const pulled = sync.lastPulledAt();
        content.appendChild(el('section', { class: 'card' }, [
          el('h3', { class: 'card__title' }, str('settings.shareTitle', 'Both phones')),
          el('p', { class: 'caption' }, str('settings.shareHint', '')),
          field(str('settings.householdCode', 'Household code'), sync.getHousehold(), null,
            (v) => { sync.setHousehold(v); return true; }),
          field(str('settings.deviceName', 'This phone is'), sync.getDevice(), null,
            (v) => { sync.setDevice(v); return true; }),
          el('p', { class: 'caption' }, pending
            ? str('settings.syncPending', '{n} waiting for signal').replace('{n}', pending)
            : (pulled ? str('settings.syncState', 'Last synced {n} ago').replace('{n}', since(pulled))
                      : str('settings.syncNever', 'Not synced yet'))),
        ]));

        // Nudges, with the iPhone caveat shown rather than discovered.
        const prefs = notify.getPrefs();
        const nudges = el('section', { class: 'card' }, [
          el('h3', { class: 'card__title' }, str('settings.notifyTitle', 'Nudges')),
          el('p', { class: 'caption' }, str('settings.notifyHint', '')),
        ]);
        if (notify.needsInstall()) {
          nudges.appendChild(el('p', { class: 'caption' }, str('settings.notifyInstall', '')));
        } else if (notify.permission() === 'denied') {
          nudges.appendChild(el('p', { class: 'caption' }, str('settings.notifyBlocked', '')));
        } else {
          nudges.appendChild(toggle(str('settings.notifyWeekly', 'The weekly focus'), prefs.weekly,
            async (next) => {
              if (next && (await notify.requestPermission()) !== 'granted') return false;
              notify.setPrefs({ ...notify.getPrefs(), weekly: next });
              return next;
            }));
        }
        content.appendChild(nudges);
      },
    });
  }

  /* -------------------------------------------------------------- buy list */

  function buySheet(fromEl) {
    openSheet({
      id: 'buy-list',
      label: str('buy.title', 'The list'),
      fromEl,
      build: (content) => {
        const items = getData().buylist || [];
        content.appendChild(el('h2', { class: 'answer__name' }, str('buy.title', 'The list')));
        content.appendChild(el('p', { class: 'caption' }, str('buy.sub', '')));

        for (const category of ['must', 'soon', 'later', 'maybe', 'borrow']) {
          const group = items.filter((i) => i.category === category);
          if (!group.length) continue;

          const left = group.filter((i) => !sync.get(`buy:${i.id}`, false));
          const low = left.reduce((n, i) => n + (i.priceLow || 0), 0);
          const high = left.reduce((n, i) => n + (i.priceHigh || 0), 0);

          const list = el('div', { class: 'ingredients' });
          for (const item of group) {
            const on = Boolean(sync.get(`buy:${item.id}`, false));
            const box = el('span', { class: 'ingredient__box', aria: { hidden: 'true' } },
              on ? icon('circle-check', { size: 22 }) : '');
            const row = el('button', { class: `ingredient${on ? ' is-done' : ''}`, type: 'button',
              aria: { pressed: String(on) } }, [
              box,
              el('span', { class: 'ingredient__text' }, [
                el('span', { class: 'ingredient__label' },
                  `${item.emoji || ''} ${item.name}${item.qty && item.qty !== '1' ? ` (${item.qty})` : ''}`.trim()),
                el('span', { class: 'ingredient__detail' }, [
                  `$${item.priceLow} to $${item.priceHigh}`,
                  item.secondHand ? str('buy.secondHand', 'Fine second hand') : '',
                  item.note || '',
                ].filter(Boolean).join(' · ')),
              ]),
            ]);
            row.addEventListener('click', () => {
              const next = !Boolean(sync.get(`buy:${item.id}`, false));
              sync.set(`buy:${item.id}`, next);
              row.classList.toggle('is-done', next);
              row.setAttribute('aria-pressed', String(next));
              box.innerHTML = next ? icon('circle-check', { size: 22 }) : '';
            });
            list.appendChild(row);
          }

          content.appendChild(el('section', { class: 'card' }, [
            el('h3', { class: 'card__title' }, [
              str(`buy.categories.${category}`, category),
              el('span', { class: 'pill' }, left.length
                ? str('buy.estimate', 'About ${low} to ${high}').replace('{low}', low).replace('{high}', high)
                : 'All done'),
            ]),
            list,
          ]));
        }
        content.appendChild(el('p', { class: 'disclaimer' }, str('buy.priceNote', '')));
      },
    });
  }

  /* --------------------------------------------------------- simple sheets */

  function listSheet(id, title, items, render) {
    return (fromEl) => openSheet({
      id, label: title, fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'answer__name' }, title));
        const rows = el('div', { class: 'rows' });
        for (const item of items()) rows.appendChild(render(item));
        content.appendChild(rows);
      },
    });
  }

  function sheetRow(label, emoji, onTap) {
    const row = el('button', { class: 'row', type: 'button' }, [
      emoji ? el('span', { class: 'row__emoji', aria: { hidden: 'true' } }, emoji) : null,
      el('span', { class: 'row__label' }, label),
      el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 20 }) }),
    ].filter(Boolean));
    row.addEventListener('click', () => onTap(row));
    return row;
  }

  function cheatSheet(sheet) {
    return (fromEl) => openSheet({
      id: `sheet-${sheet.id}`, label: sheet.name, fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'answer__name' }, `${sheet.emoji || ''} ${sheet.name}`.trim()));
        if (sheet.intro) content.appendChild(el('p', { class: 'answer__why' }, sheet.intro));
        const rows = el('div', { class: 'rows' });
        for (const row of sheet.rows || []) {
          rows.appendChild(el('div', { class: `row row--static${row.tier === 'call' ? ' row--call' : ''}` }, [
            el('span', { class: 'row__label' }, [
              el('strong', {}, row.label),
              el('span', { class: 'caption' }, row.value),
            ]),
          ]));
        }
        content.appendChild(rows);
        if (Array.isArray(sheet.asks) && sheet.asks.length) {
          content.appendChild(el('h3', { class: 'caption' }, 'Worth asking'));
          const asks = el('ul', { class: 'asks' });
          for (const ask of sheet.asks) asks.appendChild(el('li', {}, ask));
          content.appendChild(asks);
        }
      },
    });
  }

  function howtoSheet(howto) {
    return (fromEl) => openSheet({
      id: `howto-${howto.id}`, label: howto.name, fromEl,
      build: (content) => {
        content.appendChild(el('div', { class: 'answer__emoji', aria: { hidden: 'true' } }, howto.emoji || ''));
        content.appendChild(el('h2', { class: 'answer__name' }, howto.name));
        content.appendChild(el('p', { class: 'answer__why' }, howto.oneLiner || ''));
        if (howto.when) content.appendChild(el('p', { class: 'caption' }, howto.when));
        const steps = el('ol', { class: 'steps' });
        (howto.steps || []).forEach((step) => steps.appendChild(el('li', {}, step)));
        content.appendChild(steps);
        if (howto.watchOut) {
          content.appendChild(el('div', { class: 'callout callout--watch' }, [
            el('span', { html: icon('circle-alert', { size: 20, cls: 'callout__icon' }) }),
            el('p', {}, [el('strong', {}, 'Watch out: '), howto.watchOut]),
          ]));
        }
        if (howto.link) {
          content.appendChild(el('a', { class: 'btn btn--ghost', href: howto.link, rel: 'noopener', target: '_blank' },
            str('answer.readMore', 'Read the full page')));
        }
      },
    });
  }

  /** Exposed so a week checklist item can open its how-to directly. */
  function openHowto(id) {
    const howto = (getData().howtos || []).find((h) => h.id === id);
    if (howto) howtoSheet(howto)(null);
  }

  function savedSheet(fromEl) {
    const ids = store.get('saved', []);
    const entries = (Array.isArray(ids) ? ids : []).map((id) => entryById(id)).filter(Boolean);
    openSheet({
      id: 'saved', label: str('more.saved', 'Saved'), fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'answer__name' }, str('more.saved', 'Saved')));
        if (!entries.length) {
          content.appendChild(el('p', { class: 'caption' }, 'Nothing saved yet. Tap the heart on any answer.'));
          return;
        }
        const list = el('div', { class: 'results' });
        for (const entry of entries) {
          const row = el('button', { class: 'result', type: 'button' }, [
            el('span', { class: 'result__emoji', aria: { hidden: 'true' } }, entry.emoji || ''),
            el('span', { class: 'result__name' }, entry.name),
            el('span', { class: 'result__sticker', html: stickerHtml(entry.tier, { mini: true }) }),
          ]);
          row.addEventListener('click', () => {
            if (typeof ctx.openAnswerSheet === 'function') ctx.openAnswerSheet(entry, { fromEl: row });
          });
          list.appendChild(row);
        }
        content.appendChild(list);
      },
    });
  }

  function aboutSheet(fromEl) {
    openSheet({
      id: 'about', label: str('more.about', 'About'), fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'answer__name' }, str('app.name', 'Bub Appetit')));
        content.appendChild(el('p', { class: 'answer__why' }, str('app.tagline', '')));
        content.appendChild(el('h3', { class: 'caption' }, str('more.sourcesTitle', 'Where the answers come from')));
        const rows = el('div', { class: 'rows' });
        for (const key of ['rcn', 'rednose', 'aba', 'rch', 'health']) {
          const source = sourceById(key);
          if (!source) continue;
          rows.appendChild(el('a', { class: 'row', href: source.url, rel: 'noopener', target: '_blank' }, [
            el('span', { class: 'row__label' }, [
              el('strong', {}, source.name),
              source.role ? el('span', { class: 'caption' }, source.role) : null,
            ].filter(Boolean)),
          ]));
        }
        content.appendChild(rows);
        content.appendChild(el('p', { class: 'disclaimer' }, str('more.disclaimer', '')));
      },
    });
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    inner.replaceChildren();
    const data = getData();
    const host = el('div', { class: 'stack' });

    host.appendChild(el('h1', { class: 'weekhead__title' }, str('more.title', 'More')));

    // Ring now sits first and alone, because it is the one row that matters
    // when seconds do.
    const ringSheet = (data.sheets || []).find((s) => s.id === 'ring-now');
    if (ringSheet) {
      const row = sheetRow(str('more.ringNow', 'Ring now'), '🚨', cheatSheet(ringSheet));
      row.classList.add('row--call');
      host.appendChild(el('div', { class: 'rows' }, [row]));
    }

    const main = el('div', { class: 'rows' }, [
      sheetRow(str('more.buyList', 'The list'), '🛒', buySheet),
      sheetRow(str('more.cheatsheets', 'Cheat sheets'), '📋', listSheet(
        'cheatsheets', str('more.cheatsheets', 'Cheat sheets'),
        () => (data.sheets || []).filter((s) => s.id !== 'ring-now'),
        (sheet) => sheetRow(sheet.name, sheet.emoji, cheatSheet(sheet)))),
      sheetRow(str('more.howtos', 'How to do things'), '🤲', listSheet(
        'howtos', str('more.howtos', 'How to do things'),
        () => data.howtos || [],
        (howto) => sheetRow(howto.name, howto.emoji, howtoSheet(howto)))),
      sheetRow(str('more.saved', 'Saved'), '💚', savedSheet),
      sheetRow(str('more.settings', 'Settings'), '⚙️', settingsSheet),
      sheetRow(str('more.about', 'About and sources'), 'ℹ️', aboutSheet),
    ]);
    host.appendChild(main);
    host.appendChild(el('p', { class: 'disclaimer' }, str('more.disclaimer', '')));
    inner.appendChild(host);
  }

  return { id: VIEW_ID, el: root, root, onEnter: render, openSettings: settingsSheet, openHowto };
}
