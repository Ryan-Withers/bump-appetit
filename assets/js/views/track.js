// Track: feeds, sleeps and nappies, so neither of you has to remember.
//
// Every entry is its own key in the shared store, which makes this the easiest
// thing in the app to sync: log rows are written once and never edited, so two
// phones can both log at 3am with no signal and nothing collides. The only
// mutation is deleting one, and that is just another timestamped write.
//
// The number that actually matters is at the top: how long since the last feed.
// That is the question asked most often and the one neither of you can answer
// at 4am without this.

import { STRINGS } from '../strings.js';
import { $, el } from '../util.js';
import { icon } from '../icons.js';
import * as sync from '../sync.js';

const VIEW_ID = 'track';
const PREFIX = 'log:';
const KEEP_DAYS = 14;

function readPath(source, path, fallback) {
  let node = source;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return node === null || node === undefined || node === '' ? fallback : node;
}

/** "2h 14m", "6m", "3d". Short enough to read at a glance in the dark. */
function since(ms) {
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function createTrackView(ctx = {}) {
  const S = ctx.strings || STRINGS;
  const str = (path, fallback) => {
    const value = readPath(S, path, null);
    return typeof value === 'string' ? value : fallback;
  };

  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) { inner = el('div', { class: 'view__inner' }); root.appendChild(inner); }

  /* ------------------------------------------------------------------ data */

  function allLogs() {
    const out = [];
    for (const [key, value] of Object.entries(sync.getAll(PREFIX))) {
      if (!value || typeof value !== 'object' || value.deleted) continue;
      out.push({ key, ...value });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  function log(type, detail) {
    const at = Date.now();
    sync.set(`${PREFIX}${at}-${Math.random().toString(36).slice(2, 7)}`,
      { type, detail: detail || '', at, by: sync.getDevice() || '' });
    prune();
  }

  /** Old rows are tombstoned rather than kept forever: this is a log, not an archive. */
  function prune() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const entry of allLogs()) {
      if (entry.at < cutoff) sync.set(entry.key, { ...entry, deleted: true });
    }
  }

  function lastOf(type) {
    return allLogs().find((e) => e.type === type) || null;
  }

  /** Sleep is a toggle: an odd number of sleep rows today means they are asleep now. */
  function asleep() {
    const last = lastOf('sleep');
    return Boolean(last && last.detail === 'start');
  }

  /* ----------------------------------------------------------------- parts */

  function bigStat(label, value, note) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__label' }, label),
      el('span', { class: 'stat__value' }, value),
      note ? el('span', { class: 'stat__note' }, note) : null,
    ].filter(Boolean));
  }

  function actionGroup(title, buttons) {
    const row = el('div', { class: 'actions' });
    for (const [label, onTap, variant] of buttons) {
      const button = el('button', { class: `btn btn--${variant || 'soft'}`, type: 'button' }, label);
      button.addEventListener('click', () => { onTap(); render(); });
      row.appendChild(button);
    }
    return el('section', { class: 'card' }, [el('h2', { class: 'card__title' }, title), row]);
  }

  function logRow(entry) {
    const words = {
      feed: str('track.feed', 'Feed'),
      sleep: entry.detail === 'start' ? str('track.startSleep', 'Asleep') : str('track.endSleep', 'Woke up'),
      nappy: str('track.nappy', 'Nappy'),
    };
    const detail = entry.type === 'sleep' ? '' : entry.detail;
    const row = el('div', { class: 'row row--static' }, [
      el('span', { class: 'row__label' }, [
        el('strong', {}, `${clock(entry.at)}  ${words[entry.type] || entry.type}`),
        el('span', { class: 'caption' }, [
          detail,
          entry.by ? str('track.loggedBy', 'by {name}').replace('{name}', entry.by) : '',
        ].filter(Boolean).join(' · ')),
      ]),
    ]);
    const remove = el('button', { class: 'row__x', type: 'button', aria: { label: 'Remove this entry' },
      html: icon('x', { size: 18 }) });
    remove.addEventListener('click', () => { sync.set(entry.key, { ...entry, deleted: true }); render(); });
    row.appendChild(remove);
    return row;
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    inner.replaceChildren();
    const host = el('div', { class: 'stack' });

    const feed = lastOf('feed');
    const today = allLogs().filter((e) => e.at >= startOfToday());
    const nappies = today.filter((e) => e.type === 'nappy');
    const wet = nappies.filter((e) => e.detail !== 'Dirty').length;
    const dirty = nappies.filter((e) => e.detail !== 'Wet').length;

    host.appendChild(el('header', { class: 'weekhead' }, [
      el('h1', { class: 'weekhead__title' }, str('track.title', 'Track')),
      el('p', { class: 'weekhead__meta' }, str('track.sub', '')),
    ]));

    host.appendChild(el('div', { class: 'stats' }, [
      bigStat(str('track.lastFeed', 'Last feed'),
        feed ? since(feed.at) : '-',
        feed ? [clock(feed.at), feed.detail].filter(Boolean).join(' · ') : str('track.never', 'Nothing yet')),
      bigStat(str('track.todayNappies', 'Nappies today'),
        String(nappies.length),
        `${wet} wet · ${dirty} dirty`),
    ]));

    host.appendChild(actionGroup(str('track.feed', 'Feed'), [
      [str('track.left', 'Left'), () => log('feed', 'Left')],
      [str('track.right', 'Right'), () => log('feed', 'Right')],
      [str('track.bottle', 'Bottle'), () => log('feed', 'Bottle')],
    ]));

    host.appendChild(actionGroup(str('track.sleep', 'Sleep'), [
      asleep()
        ? [str('track.endSleep', 'Woke up'), () => log('sleep', 'end'), 'primary']
        : [str('track.startSleep', 'Asleep now'), () => log('sleep', 'start'), 'primary'],
    ]));

    host.appendChild(actionGroup(str('track.nappy', 'Nappy'), [
      [str('track.wet', 'Wet'), () => log('nappy', 'Wet')],
      [str('track.dirty', 'Dirty'), () => log('nappy', 'Dirty')],
      [str('track.both', 'Both'), () => log('nappy', 'Both')],
    ]));

    if (today.length) {
      const rows = el('div', { class: 'rows' });
      for (const entry of today) rows.appendChild(logRow(entry));
      host.appendChild(el('section', { class: 'card' }, [
        el('h2', { class: 'card__title' }, str('track.todayTitle', 'Today')), rows,
      ]));
    } else {
      host.appendChild(el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title' }, str('track.emptyTitle', 'Nothing logged yet today')),
        el('p', {}, str('track.emptyBody', '')),
      ]));
    }

    inner.appendChild(host);
  }

  sync.subscribe(() => { if (root.classList.contains('is-active')) render(); });

  return { id: VIEW_ID, el: root, root, onEnter: render };
}
