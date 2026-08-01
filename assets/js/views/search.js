// The home screen, and the reason the app exists: type a food, get a straight
// answer. Everything renders synchronously from in-memory data, so a keystroke
// turns into results inside one frame and no spinner is ever needed.

import { CONFIG } from '../config.js';
import { STRINGS } from '../strings.js';
import { $, el, pick, prefersReducedMotion, store, todayKey } from '../util.js';
import { icon } from '../icons.js';
import { search, browseGroup } from '../search.js';
import { groups } from '../data.js';
import { stickerHtml } from '../sticker.js';

const VIEW_ID = 'search';

const DEBOUNCE_MS = 80;
const RESULT_LIMIT = 5;      // build spec 8.3: show max 5
const RECENTS_MAX = 5;
const RECENT_MIN_CHARS = 2;

const ROW_MS = 240;          // matches --dur-2
const STAGGER_MS = 24;
const STAGGER_CAP = 6;       // a long list must never feel slow
const REDUCED_MS = 150;      // the reduced-motion ceiling

const EMPTY_EMOJI_PX = 44;

// Time buckets from build spec 5.1, as [startHour, key]. The last bucket wraps
// past midnight, which is why the lookup walks the list in reverse.
const GREETING_BUCKETS = Object.freeze([
  [5, 'morning'],
  [11, 'lunch'],
  [14, 'arvo'],
  [17, 'dinner'],
  [21, 'night'],
]);

// Alternative key spellings are tried in order, so a reasonable rename in
// strings.js does not silently drop the greeting.
const GREETING_KEYS = Object.freeze({
  morning: ['greetings.morning'],
  lunch: ['greetings.lunch', 'greetings.midday'],
  arvo: ['greetings.arvo', 'greetings.afternoon'],
  dinner: ['greetings.dinner', 'greetings.evening'],
  night: ['greetings.night', 'greetings.lateNight'],
});

const GREETING_FALLBACKS = Object.freeze({
  morning: 'Morning, {name} ☀️',
  lunch: 'Lunch o\'clock, legend',
  arvo: 'Arvo snack scouting?',
  dinner: 'What\'s for dinner, {name}?',
  night: '3am club 🌙 no judgement, only snacks',
});

// One chip per tier, so the system teaches itself with zero instructions:
// brie is a HOLD, flat white a LIMIT, sushi a DEPENDS, avo toast a GO.
const STARTER_FALLBACKS = Object.freeze([
  '🧀 brie',
  '☕ flat white',
  '🍣 sushi',
  '🥑 avo toast',
  '🍦 soft serve',
]);

const tokenCache = new Map();

/**
 * Motion tokens live in :root, so JS-driven animations stay in step with the
 * CSS ones. The pattern test keeps a malformed custom property from throwing
 * inside element.animate().
 */
function cssToken(name, fallback) {
  if (tokenCache.has(name)) return tokenCache.get(name);
  let value = fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (raw && /^[a-z0-9 ().,-]+$/i.test(raw)) value = raw;
  } catch {
    value = fallback;
  }
  tokenCache.set(name, value);
  return value;
}

const easeOut = () => cssToken('--ease-out', 'cubic-bezier(.22,1,.36,1)');

/** Reads a dot path, trying each candidate in turn, so a missing key degrades. */
function readPath(source, paths, fallback) {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const path of list) {
    let node = source;
    let found = true;
    for (const key of String(path).split('.')) {
      if (!node || typeof node !== 'object' || !(key in node)) {
        found = false;
        break;
      }
      node = node[key];
    }
    if (found && node !== null && node !== undefined && node !== '') return node;
  }
  return fallback;
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hourBucket(date = new Date()) {
  const hour = date.getHours();
  for (let i = GREETING_BUCKETS.length - 1; i >= 0; i -= 1) {
    if (hour >= GREETING_BUCKETS[i][0]) return GREETING_BUCKETS[i][1];
  }
  // Midnight to 5am belongs to the bucket that started the evening before.
  return 'night';
}

/** groups() throws before loadData(). A browse grid is never worth a blank view. */
function safeGroups() {
  try {
    return groups() || [];
  } catch {
    return [];
  }
}

function readRecents() {
  const saved = store.get('recents', []);
  if (!Array.isArray(saved)) return [];
  return saved.filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, RECENTS_MAX);
}

/**
 * Recorded only when a result is actually opened, never on a keystroke. A list
 * of half-typed fragments would be noise, and this list has to earn its space.
 */
function recordRecent(query) {
  const value = String(query === null || query === undefined ? '' : query).trim();
  if (value.length < RECENT_MIN_CHARS) return;
  const kept = readRecents().filter((entry) => entry.toLowerCase() !== value.toLowerCase());
  store.set('recents', [value, ...kept].slice(0, RECENTS_MAX));
}

/** Accepts '🧀 brie' or { emoji, query, label }, so strings.js can use either. */
function normaliseChip(entry) {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const gap = trimmed.indexOf(' ');
    if (gap < 0) return { emoji: '', query: trimmed };
    return { emoji: trimmed.slice(0, gap), query: trimmed.slice(gap + 1).trim() };
  }
  if (entry && typeof entry === 'object') {
    const query = String(entry.query || entry.label || '').trim();
    if (!query) return null;
    return { emoji: String(entry.emoji || ''), query };
  }
  return null;
}

export function createSearchView(ctx = {}) {
  const S = ctx.strings || STRINGS || {};
  const conf = ctx.config || CONFIG || {};

  const str = (paths, fallback) => {
    const value = readPath(S, paths, null);
    return typeof value === 'string' ? value : fallback;
  };

  /** Greeting lines may be a single string or a bank to pick from. */
  const line = (paths, fallback, seed) => {
    const value = readPath(S, paths, null);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const picked = pick(value.filter((entry) => typeof entry === 'string' && entry), seed);
      if (picked) return picked;
    }
    return fallback;
  };

  const starterChips = () => {
    const value = readPath(S, ['search.starters', 'starters'], null);
    const source = Array.isArray(value) && value.length ? value : STARTER_FALLBACKS;
    return source.map(normaliseChip).filter(Boolean);
  };

  /* ----------------------------------------------------------------- shell */

  // index.html ships the view shell, so the router finds a claimed panel and
  // the layout never depends on JS having run first.
  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) {
    inner = el('div', { class: 'view__inner' });
    root.appendChild(inner);
  }
  inner.replaceChildren();

  const greeting = el('h1', { class: 'greeting' });
  const greetingSub = el('p', {
    class: 'greeting__sub',
    text: str('searchSub', 'Type a food. Get a straight answer.'),
  });

  const clearLabel = str(['search.clear', 'a11y.clearSearch'], 'Clear search');

  const input = el('input', {
    class: 'searchbar__input',
    type: 'search',
    name: 'q',
    // Every one of these is load-bearing on iOS: 17px stops the focus zoom,
    // and the four correction attributes stop Safari rewriting food names.
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: str('searchPlaceholder', 'brie, sushi, flat white...'),
    aria: { label: str('a11y.searchField', 'Search foods') },
  });

  const clearBtn = el('button', {
    class: 'searchbar__clear',
    type: 'button',
    hidden: true,
    aria: { label: clearLabel },
    html: icon('x', { size: 20 }),
  });

  const searchbar = el('form', { class: 'searchbar', role: 'search' }, [
    el('span', { class: 'searchbar__icon', aria: { hidden: 'true' }, html: icon('search', { size: 20 }) }),
    input,
    clearBtn,
  ]);

  const live = el('p', { class: 'sr-only', role: 'status', aria: { live: 'polite', atomic: 'true' } });

  const stage = el('div', { class: 'stack' });

  inner.append(greeting, greetingSub, searchbar, live, stage);

  /* ----------------------------------------------------------------- parts */

  function renderGreeting() {
    const bucket = hourBucket();
    // Seeded by the day so the line holds still while she uses the app, and
    // still changes tomorrow.
    const template = line(GREETING_KEYS[bucket], GREETING_FALLBACKS[bucket], `${bucket}:${todayKey()}`);
    greeting.textContent = fill(template, { name: conf.name || '' }).trim();
  }

  function openFood(food, row) {
    if (typeof ctx.openFoodSheet !== 'function') return;
    ctx.openFoodSheet(food, { fromEl: row });
  }

  function foodRow(food, onOpen) {
    const row = el('button', { class: 'result', type: 'button', data: { id: food.id || '' } }, [
      // The emoji is hidden from assistive tech: the name and the sticker word
      // already carry the row, and "cheese wedge" adds nothing but noise.
      el('span', { class: 'result__emoji', aria: { hidden: 'true' }, text: food.emoji || '' }),
      el('span', { class: 'result__name', text: food.name || '' }),
      el('span', { class: 'result__sticker', html: stickerHtml(food.tier, { mini: true }) }),
    ]);
    row.addEventListener('click', () => {
      if (typeof onOpen === 'function') onOpen();
      openFood(food, row);
    });
    return row;
  }

  function animateRows(rows) {
    const reduced = prefersReducedMotion();
    const capped = Math.min(rows.length, STAGGER_CAP);
    for (let i = 0; i < capped; i += 1) {
      const row = rows[i];
      if (!row || typeof row.animate !== 'function') continue;
      if (reduced) {
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: 'linear' });
        continue;
      }
      // fill: backwards holds the row invisible through its stagger delay, so
      // it arrives rather than blinking out and back in.
      row.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: ROW_MS, delay: i * STAGGER_MS, easing: easeOut(), fill: 'backwards' });
    }
  }

  function openGroupSheet(entry, fromEl) {
    if (typeof ctx.openSheet !== 'function') return;
    ctx.openSheet({
      id: `group-${slug(entry.group)}`,
      label: entry.group,
      fromEl,
      build: (content) => {
        content.appendChild(el('h2', { class: 'group-title', text: entry.group }));
        const list = el('div', { class: 'results' });
        for (const food of browseGroup(entry.group)) list.appendChild(foodRow(food));
        content.appendChild(list);
      },
    });
  }

  function recentRows() {
    const recents = readRecents();
    if (!recents.length) return [];

    const list = el('div', { class: 'recents' });
    for (const query of recents) {
      list.appendChild(el('button', {
        class: 'row',
        type: 'button',
        on: {
          click: () => {
            input.value = query;
            renderNow();
          },
        },
      }, [
        el('span', { class: 'row__label', text: query }),
        el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 20 }) }),
      ]));
    }

    return [
      el('h2', { class: 'caption', text: str('search.recentsTitle', 'Recent') }),
      list,
    ];
  }

  function chipsRow() {
    const chips = starterChips();
    if (!chips.length) return null;

    const wrap = el('div', {
      class: 'chips',
      role: 'group',
      aria: { label: str(['search.chipsLabel', 'a11y.starters'], 'Try one of these') },
    });

    for (const chip of chips) {
      wrap.appendChild(el('button', {
        class: 'chip',
        type: 'button',
        // Labelled with the query alone, so the emoji stays decoration to a
        // screen reader while still reading as content on screen.
        aria: { label: chip.query },
        text: chip.emoji ? `${chip.emoji} ${chip.query}` : chip.query,
        on: {
          click: () => {
            input.value = chip.query;
            renderNow();
          },
        },
      }));
    }
    return wrap;
  }

  function browseTiles() {
    const entries = safeGroups().filter((entry) => entry && entry.count > 0);
    if (!entries.length) return [];

    const grid = el('div', { class: 'tiles' });
    for (const entry of entries) {
      const tile = el('button', { class: 'tile', type: 'button', data: { group: entry.group } }, [
        el('span', { class: 'tile__emoji', aria: { hidden: 'true' }, text: entry.emoji || '' }),
        el('span', { class: 'tile__name', text: entry.group }),
        el('span', {
          class: 'tile__count',
          text: fill(str('search.browseCount', '{n} foods'), { n: entry.count }),
        }),
      ]);
      tile.addEventListener('click', () => openGroupSheet(entry, tile));
      grid.appendChild(tile);
    }

    return [
      el('h2', { class: 'caption', text: str('search.browseTitle', 'Browse') }),
      grid,
    ];
  }

  function idleContent() {
    const host = el('div', { class: 'stack' });
    // Recents only after she has engaged with the field: on a cold open the
    // screen stays quiet, exactly like not autofocusing.
    if (hasFocused) host.append(...recentRows());
    const chips = chipsRow();
    if (chips) host.appendChild(chips);
    host.append(...browseTiles());
    return host;
  }

  function emptyContent(query) {
    const host = el('div', { class: 'empty' }, [
      el('span', {
        class: 'empty__emoji',
        aria: { hidden: 'true' },
        // Inline so the size is right even before the stylesheet knows this
        // class: the spec pins it at 44px.
        style: { fontSize: `${EMPTY_EMOJI_PX}px`, lineHeight: '1' },
        text: str('empty.emoji', '🤔'),
      }),
      el('p', {
        class: 'empty__title',
        text: fill(
          str('empty.title', 'Hmm, \'{query}\' isn\'t in my cookbook yet.'),
          { query }
        ),
      }),
      el('p', {
        text: str(
          'empty.body',
          'When in doubt: freshly cooked, steaming hot, from a clean kitchen is the safest bet.'
        ),
      }),
    ]);

    const actions = el('div', { class: 'stack' });

    if (conf.suggestUrl) {
      actions.appendChild(el('a', {
        class: 'btn btn--primary',
        href: conf.suggestUrl,
        // Opens in Safari rather than hijacking the installed app view.
        target: '_blank',
        rel: 'noopener',
      }, [
        str('ui.buttons.suggest', 'Ask Ryan to add it'),
        el('span', { class: 'sr-only', text: ` ${str('a11y.externalLink', 'Opens in Safari')}` }),
      ]));
    }

    actions.appendChild(el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: clearLabel,
      on: { click: clearSearch },
    }));

    host.appendChild(actions);
    return host;
  }

  function resultsContent(state, rawQuery) {
    const host = el('div', { class: 'stack' });
    const rows = [];

    // A weak best match is offered as a near miss, never as the answer.
    if (state.soft) {
      host.appendChild(el('p', { class: 'soft-label', text: softLabel() }));
    }

    const list = el('div', { class: 'results' });
    for (const hit of state.results) {
      if (!hit || !hit.food) continue;
      const row = foodRow(hit.food, () => recordRecent(rawQuery));
      rows.push(row);
      list.appendChild(row);
    }
    host.appendChild(list);

    return { host, rows };
  }

  /* ---------------------------------------------------------------- render */

  const softLabel = () => str('search.softLabel', 'Closest match');

  function countText(n, soft) {
    let base;
    if (n === 0) base = str('search.resultsNone', 'No matches');
    else if (n === 1) base = str('search.resultsOne', '1 match');
    else base = fill(str('search.resultsMany', '{n} matches'), { n });
    return soft ? `${softLabel()}: ${base}` : base;
  }

  function announce(text) {
    live.textContent = text;
  }

  function toggleClear() {
    const show = Boolean(input.value);
    clearBtn.hidden = !show;
    // The attribute alone is not enough: any `.searchbar__clear { display: … }`
    // rule outranks the UA's [hidden], and a dead X beside an empty field is a
    // bug she would feel. The inline value settles it either way.
    clearBtn.style.display = show ? '' : 'none';
  }

  let hasFocused = false;
  let timer = 0;

  function render() {
    toggleClear();
    const raw = input.value;
    const query = raw.trim();

    if (!query) {
      announce('');
      stage.replaceChildren(idleContent());
      return;
    }

    const state = search(query, RESULT_LIMIT);

    if (!state.results.length) {
      stage.replaceChildren(emptyContent(query));
      announce(countText(0, false));
      return;
    }

    const built = resultsContent(state, raw);
    stage.replaceChildren(built.host);
    animateRows(built.rows);
    announce(countText(built.rows.length, state.soft));
  }

  function renderNow() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    render();
  }

  function clearSearch() {
    input.value = '';
    renderNow();
    input.focus();
  }

  /* ------------------------------------------------------------------ wiring */

  input.addEventListener('input', () => {
    toggleClear();
    if (timer) clearTimeout(timer);
    // 80ms is long enough to skip the middle of a fast word and short enough
    // that the list never feels like it is catching up.
    timer = setTimeout(() => {
      timer = 0;
      render();
    }, DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    if (hasFocused) return;
    hasFocused = true;
    if (!input.value.trim()) renderNow();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    event.preventDefault();
    clearSearch();
  });

  clearBtn.addEventListener('click', clearSearch);

  searchbar.addEventListener('submit', (event) => {
    // Enter never reloads the page. It settles the pending debounce and drops
    // the keyboard, which is what "Search" means with one thumb in a queue.
    event.preventDefault();
    renderNow();
    input.blur();
  });

  renderGreeting();
  render();

  return {
    id: VIEW_ID,
    el: root,

    onEnter() {
      // The greeting is time-aware, and she may have been away for hours.
      renderGreeting();
      render();
    },

    onLeave() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      // Leaving with the keyboard up would cover the view she just moved to.
      if (document.activeElement === input) input.blur();
    },
  };
}
