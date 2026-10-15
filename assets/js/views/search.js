// The home screen, and the reason the app exists: type what is happening, get a
// straight answer. Everything renders from memory, so a keystroke becomes
// results inside one frame and there is never a spinner.

import { CONFIG } from '../config.js';
import { STRINGS } from '../strings.js';
import { $, el, pick, store } from '../util.js';
import { icon } from '../icons.js';
import { search, browseGroup } from '../search.js';
import { groups } from '../data.js';
import { stickerHtml } from '../sticker.js';
import { hasAsk, looksUrgent } from '../ask.js';

const VIEW_ID = 'search';
const DEBOUNCE_MS = 80;
const RESULT_LIMIT = 6;
const RECENTS_MAX = 5;

const GREETING_BUCKETS = [[5, 'morning'], [11, 'day'], [17, 'evening'], [21, 'night']];

function bucketNow(date = new Date()) {
  const hour = date.getHours();
  for (let i = GREETING_BUCKETS.length - 1; i >= 0; i -= 1) {
    if (hour >= GREETING_BUCKETS[i][0]) return GREETING_BUCKETS[i][1];
  }
  return 'night';
}

function readPath(source, path, fallback) {
  let node = source;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return node === null || node === undefined || node === '' ? fallback : node;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function safeGroups() {
  try { return groups() || []; } catch { return []; }
}

export function createSearchView(ctx = {}) {
  const S = ctx.strings || STRINGS;
  const conf = ctx.config || CONFIG;
  const str = (path, fallback) => {
    const value = readPath(S, path, null);
    return typeof value === 'string' ? value : fallback;
  };

  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) { inner = el('div', { class: 'view__inner' }); root.appendChild(inner); }
  inner.replaceChildren();

  const greeting = el('h1', { class: 'greeting' });
  const sub = el('p', { class: 'greeting__sub', text: str('searchSub', 'Type what is happening.') });

  const input = el('input', {
    class: 'searchbar__input',
    type: 'search',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: str('searchPlaceholder', 'green poo, wont settle...'),
    aria: { label: str('searchPlaceholder', 'Search') },
  });

  const clear = el('button', {
    class: 'searchbar__clear',
    type: 'button',
    hidden: true,
    aria: { label: str('a11y.clearSearch', 'Clear search') },
    html: icon('x', { size: 20 }),
  });

  const bar = el('div', { class: 'searchbar' }, [
    el('span', { class: 'searchbar__icon', aria: { hidden: 'true' }, html: icon('search', { size: 22 }) }),
    input, clear,
  ]);

  const live = el('p', { class: 'sr-only', aria: { live: 'polite' } });
  const results = el('div', { class: 'results-host' });

  inner.append(greeting, sub, bar, live, results);

  let hasFocused = false;
  let timer = null;

  /* ---------------------------------------------------------------- pieces */

  function readRecents() {
    const saved = store.get('recents', []);
    return Array.isArray(saved) ? saved.filter((q) => typeof q === 'string' && q.trim()).slice(0, RECENTS_MAX) : [];
  }

  function recordRecent(query) {
    const value = String(query || '').trim();
    if (value.length < 2) return;
    const kept = readRecents().filter((q) => q.toLowerCase() !== value.toLowerCase());
    store.set('recents', [value, ...kept].slice(0, RECENTS_MAX));
  }

  function openEntry(entry, row) {
    recordRecent(input.value);
    if (typeof ctx.openAnswerSheet === 'function') ctx.openAnswerSheet(entry, { fromEl: row });
  }

  function entryRow(entry) {
    const row = el('button', { class: 'result', type: 'button', data: { id: entry.id } }, [
      el('span', { class: 'result__emoji', aria: { hidden: 'true' } }, entry.emoji || ''),
      el('span', { class: 'result__name' }, entry.name || ''),
      el('span', { class: 'result__sticker', html: stickerHtml(entry.tier, { mini: true }) }),
    ]);
    row.addEventListener('click', () => openEntry(entry, row));
    return row;
  }

  function askRow(query) {
    if (!hasAsk() || typeof ctx.openAsk !== 'function') return null;
    const button = el('button', { class: 'askrow', type: 'button' }, [
      el('span', { class: 'askrow__icon', aria: { hidden: 'true' }, html: icon('sparkles', { size: 20 }) }),
      el('span', { class: 'askrow__text' }, [
        el('span', { class: 'askrow__label' }, str('search.askButton', 'Ask about this')),
        el('span', { class: 'askrow__note' }, str('search.askNote', 'Answers come from the notes in this app.')),
      ]),
    ]);
    button.addEventListener('click', () => ctx.openAsk(query));
    return button;
  }

  function browseTiles() {
    const entries = safeGroups().filter((g) => g && g.count > 0);
    if (!entries.length) return [];
    const grid = el('div', { class: 'tiles' });
    for (const entry of entries) {
      const tile = el('button', { class: 'tile', type: 'button' }, [
        el('span', { class: 'tile__emoji', aria: { hidden: 'true' } }, entry.emoji || ''),
        el('span', { class: 'tile__name' }, entry.group),
        el('span', { class: 'tile__count' },
          str('search.browseCount', '{n} answers').replace('{n}', entry.count)),
      ]);
      tile.addEventListener('click', () => openGroup(entry, tile));
      grid.appendChild(tile);
    }
    return [el('h2', { class: 'caption' }, str('search.browseTitle', 'Or have a browse')), grid];
  }

  function openGroup(entry, fromEl) {
    if (typeof ctx.openSheet !== 'function') return;
    ctx.openSheet({
      id: `group-${slug(entry.group)}`,
      label: entry.group,
      fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'group-title' }, entry.group));
        const list = el('div', { class: 'results' });
        for (const item of browseGroup(entry.group)) list.appendChild(entryRow(item));
        content.appendChild(list);
      },
    });
  }

  function chipsRow() {
    const chips = readPath(S, 'starterChips', []);
    if (!Array.isArray(chips) || !chips.length) return null;
    const wrap = el('div', { class: 'chips', role: 'group',
      aria: { label: str('search.chipsLabel', 'Try one of these') } });
    for (const chip of chips) {
      const button = el('button', { class: 'chip', type: 'button', aria: { label: chip.query } },
        chip.emoji ? `${chip.emoji} ${chip.label}` : chip.label);
      button.addEventListener('click', () => { input.value = chip.query; render(); });
      wrap.appendChild(button);
    }
    return wrap;
  }

  function recentRows() {
    const recents = readRecents();
    if (!recents.length) return [];
    const list = el('div', { class: 'rows' });
    for (const query of recents) {
      const row = el('button', { class: 'row', type: 'button' }, [
        el('span', { class: 'row__label' }, query),
        el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 20 }) }),
      ]);
      row.addEventListener('click', () => { input.value = query; render(); });
      list.appendChild(row);
    }
    return [el('h2', { class: 'caption' }, str('search.recentsTitle', 'Recent')), list];
  }

  /* ---------------------------------------------------------------- render */

  function idleContent() {
    const host = el('div', { class: 'stack' });
    if (hasFocused) host.append(...recentRows());
    const chips = chipsRow();
    if (chips) host.appendChild(chips);
    host.append(...browseTiles());
    return host;
  }

  function emptyContent(query) {
    const host = el('div', { class: 'stack' });
    host.appendChild(el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, str('search.noneTitle', 'Nothing here for that one')),
      el('p', {}, str('search.noneBody', '')),
    ]));
    const ask = askRow(query);
    if (ask) host.appendChild(ask);
    return host;
  }

  function render() {
    const raw = input.value;
    const query = String(raw || '').trim();
    clear.hidden = !query;

    if (!query) {
      results.replaceChildren(idleContent());
      live.textContent = '';
      return;
    }

    const state = search(query, RESULT_LIMIT);
    if (!state.results.length) {
      results.replaceChildren(emptyContent(query));
      live.textContent = str('search.resultsNone', 'No matches');
      return;
    }

    const host = el('div', { class: 'stack' });

    // An urgent-sounding question skips straight to the phone, before any list.
    if (looksUrgent(query)) {
      host.appendChild(el('div', { class: 'urgent' }, [
        el('p', { class: 'urgent__title' }, 'Ring 000 now'),
        el('a', { class: 'callbtn', href: 'tel:000', aria: { label: 'Ring triple zero' } }, [
          el('span', { class: 'callbtn__icon', aria: { hidden: 'true' }, html: icon('phone', { size: 22 }) }),
          el('span', { class: 'callbtn__text' }, [el('span', { class: 'callbtn__who' }, 'Triple Zero'), el('span', { class: 'callbtn__num' }, '000')]),
        ]),
      ]));
    }

    if (state.soft) {
      host.appendChild(el('p', { class: 'caption' }, str('search.softNote', '')));
    }

    const list = el('div', { class: 'results' });
    for (const hit of state.results) list.appendChild(entryRow(hit.entry));
    host.appendChild(list);

    const ask = askRow(query);
    if (ask) {
      host.appendChild(el('h2', { class: 'caption' }, str('search.askTitle', 'Still not it?')));
      host.appendChild(ask);
    }

    results.replaceChildren(host);
    const n = state.results.length;
    live.textContent = n === 1
      ? str('search.resultsOne', '1 match')
      : str('search.resultsMany', '{n} matches').replace('{n}', n);
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, DEBOUNCE_MS);
  });
  input.addEventListener('focus', () => { hasFocused = true; });
  clear.addEventListener('click', () => { input.value = ''; input.focus(); render(); });

  return {
    id: VIEW_ID,
    // The router keys off `el`. `root` is kept as an alias so a view reads the
    // same way from either side.
    el: root,
    root,
    onEnter() {
      const key = bucketNow();
      const line = (readPath(S, 'greetings', []) || []).find((g) => g.id === key);
      const name = String((conf && conf.name) || '').trim();
      greeting.textContent = (line ? line.text : 'Hello').replace('{name}', name || 'you');
      render();
    },
  };
}
