// Bootstrap. Loads the data once, builds the four views, wires the sheets and
// the router, and gets out of the way.

import { CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { $, el } from './util.js';
import { loadData, getData } from './data.js';
import { initSearch } from './search.js';
import { initRouter, go } from './router.js';
import { openSheet } from './sheet.js';
import { openAnswerSheet, openHowWeDecideSheet, setHowtoOpener } from './answer.js';
import { createSearchView } from './views/search.js';
import { createTrackView } from './views/track.js';
import { createWeekView } from './views/week.js';
import { createMoreView } from './views/more.js';
import { ask, hasAsk } from './ask.js';
import { stickerHtml } from './sticker.js';
import { icon } from './icons.js';
import * as sync from './sync.js';
import * as notify from './notify.js';

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

/* ------------------------------------------------------------------ the ask */

/**
 * The Ask sheet. Shows the answer, and underneath it the actual entry cards it
 * was built from, so she can always read the note herself rather than taking a
 * summary on trust. That is the honesty mechanism, not a nicety.
 */
function openAskSheet(question) {
  openSheet({
    id: 'ask',
    label: str('ask.title', 'Ask'),
    build: (content) => {
      content.appendChild(el('h2', { class: 'answer__name' }, str('ask.title', 'Ask')));
      content.appendChild(el('p', { class: 'answer__why' }, question));
      const body = el('div', { class: 'stack' }, [
        el('p', { class: 'caption' }, str('ask.thinking', 'Reading the notes...')),
      ]);
      content.appendChild(body);
      content.appendChild(el('p', { class: 'disclaimer' }, str('ask.groundedNote', '')));

      ask(question).then((result) => {
        body.replaceChildren();

        if (!result.grounded || !result.answer) {
          body.appendChild(el('p', { class: 'answer__why' }, str('ask.noAnswer', '')));
        } else {
          body.appendChild(el('p', { class: 'answer__why' }, result.answer));
        }

        if (result.ring) {
          const row = el('div', { class: 'row row--static row--call' }, [
            el('span', { class: 'row__label' }, [el('strong', {}, `Ring ${result.ring}`)]),
          ]);
          body.appendChild(el('div', { class: 'rows' }, [row]));
        }

        if (result.entries.length) {
          body.appendChild(el('h3', { class: 'caption' }, 'Where this came from'));
          const list = el('div', { class: 'results' });
          for (const entry of result.entries) {
            const row = el('button', { class: 'result', type: 'button' }, [
              el('span', { class: 'result__emoji', aria: { hidden: 'true' } }, entry.emoji || ''),
              el('span', { class: 'result__name' }, entry.name),
              el('span', { class: 'result__sticker', html: stickerHtml(entry.tier, { mini: true }) }),
            ]);
            row.addEventListener('click', () => openAnswerSheet(entry, { fromEl: row }));
            list.appendChild(row);
          }
          body.appendChild(list);
        }
      }).catch((err) => {
        const kind = (err && err.kind) || 'failed';
        const copy = {
          offline: str('ask.offline', ''),
          limit: str('ask.limit', ''),
        }[kind] || str('ask.errorBody', '');
        body.replaceChildren(
          el('p', { class: 'empty__title' }, str('ask.errorTitle', 'That did not go through')),
          el('p', { class: 'caption' }, copy),
        );
      });
    },
  });
}

/* ------------------------------------------------------------------- shell */

function showError(host, retry) {
  host.replaceChildren(el('div', { class: 'empty' }, [
    el('p', { class: 'empty__title' }, str('app.loadErrorTitle', 'That did not open')),
    el('p', {}, str('app.loadErrorBody', '')),
    (() => {
      const button = el('button', { class: 'btn btn--primary', type: 'button' },
        str('ui.buttons.retry', 'Have another go'));
      button.addEventListener('click', retry);
      return button;
    })(),
  ]));
}

function paintTabLabels() {
  for (const node of document.querySelectorAll('[data-string]')) {
    const value = str(node.getAttribute('data-string'), null);
    if (value) node.textContent = value;
  }
}

async function start() {
  const app = $('#app') || document.body;
  paintTabLabels();

  try {
    await loadData();
  } catch {
    showError($('#view-search .view__inner') || app, () => start());
    return;
  }

  const data = getData();
  initSearch(data.entries);

  const ctx = {
    data, strings: STRINGS, config: CONFIG,
    go, openSheet, openAnswerSheet,
    openAsk: hasAsk() ? openAskSheet : null,
    openHowto: null,
    openSettings: null,
  };

  const more = createMoreView(ctx);
  // The week checklist and the answer sheet both need to open a how-to, and
  // More owns that sheet, so the opener is handed back through ctx.
  ctx.openHowto = more.openHowto;
  ctx.openSettings = () => more.openSettings(null);
  setHowtoOpener(more.openHowto);

  const views = [createSearchView(ctx), createTrackView(ctx), createWeekView(ctx), more];

  // The router calls each view's own onEnter, so there is nothing to forward.
  initRouter({ views });

  sync.startSync();
  notify.checkWeekRollover(data.weeks).catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// `how we decide` is reachable from the disclaimer anywhere in the app.
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-how-we-decide]');
  if (trigger) openHowWeDecideSheet({ fromEl: trigger });
});

// A boot that fails silently leaves a blank screen and no clue. Anything that
// escapes start() is surfaced on screen and in the console rather than lost.
start().catch((err) => {
  console.error('Bub Appetit failed to start', err);
  const host = $('#view-search .view__inner') || document.body;
  showError(host, () => start().catch(() => {}));
});
