// The bootstrap.
//
// Every other module in this app waits to be asked. This is the file that does
// the asking, in the order the architecture contract sets out, and it owns the
// handful of behaviours that belong to the whole app rather than to any one
// screen: installed-mode detection, the single loading indicator, the footer,
// the service worker update toast, the iOS install hint, and the keyboard.

import { CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { $, $$, el, onceRaf, prefersReducedMotion, store } from './util.js';
import { icon } from './icons.js';
import { loadData } from './data.js';
import { initSearch } from './search.js';
import { initRouter, go } from './router.js';
import { openSheet } from './sheet.js';
import { openFoodSheet, openHowWeDecideSheet, setNutrientBrowser } from './verdict.js';
import { createSearchView } from './views/search.js';
// Scan, Bites and More are imported on demand further down. Search is the only
// view that has to exist to paint the first screen, and dragging the scanner
// and the trackers into that first paint costs about a third of the app's
// JavaScript for screens she has not asked for yet.

// The only loading indicator in the app, and it is on a delay: a warm open
// resolves from the service worker cache in well under this, so on almost every
// open of her life she never sees a spinner at all.
const SPINNER_DELAY_MS = 300;
const SPINNER_SPIN_MS = 900;

const TOAST_MS = 5000;

// A visual viewport this much shorter than the window means the keyboard is up.
const KEYBOARD_MIN_PX = 120;

// If controllerchange never lands after SKIP_WAITING, reload anyway.
const UPDATE_FALLBACK_MS = 2500;

const ENCOURAGEMENT_KEY = 'encouragement';
const HINT_KEY = 'hint-dismissed';

/* ------------------------------------------------------------------ strings */

function readPath(source, path) {
  let node = source;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Reads a string by dot path, trying each candidate in turn. Copy is written by
 * a different pair of hands to this file, so a missing key degrades to a
 * sensible line rather than putting "undefined" in front of her.
 */
function str(paths, fallback = '') {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const path of list) {
    const value = readPath(STRINGS, path);
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

function strList(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  for (const path of list) {
    const value = readPath(STRINGS, path);
    if (!Array.isArray(value)) continue;
    const kept = value.filter((entry) => typeof entry === 'string' && entry.trim());
    if (kept.length) return kept;
  }
  return [];
}

/** index.html ships real text so the shell is never blank, then this tunes it. */
function applyStringHooks(root = document) {
  for (const node of $$('[data-string]', root)) {
    const value = str(node.dataset.string, '');
    if (value) node.textContent = value;
  }

  // "aria-label:a11y.close", or several of those separated by commas.
  for (const node of $$('[data-string-attr]', root)) {
    for (const pair of String(node.dataset.stringAttr).split(',')) {
      const bits = pair.split(':');
      const attr = String(bits[0] || '').trim();
      const path = String(bits[1] || '').trim();
      if (!attr || !path) continue;
      const value = str(path, '');
      if (value) node.setAttribute(attr, value);
    }
  }
}

/** The svg element itself, so it can sit directly in a flex row. */
function iconNode(name, size = 24) {
  const markup = icon(name, { size });
  if (!markup) return null;
  return el('span', { html: markup }).firstElementChild;
}

/* -------------------------------------------------------- installed mode (1) */

function isStandalone() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // Safari has thrown on odd media queries before now. Fall through.
  }
  return window.navigator.standalone === true;
}

function markStandalone() {
  const standalone = isStandalone();
  document.documentElement.classList.toggle('is-standalone', standalone);
  return standalone;
}

/**
 * iOS is the only platform without an install prompt API, so the hint is the
 * only way in. Every other iOS browser and every in-app webview is excluded,
 * because "tap Share, then Add to Home Screen" is not true in any of them.
 */
function isIosSafari() {
  const ua = String(navigator.userAgent || '');
  const iPhone = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13 and up claim to be a Mac, and only a touch Mac is an iPad.
  const iPad = ua.includes('Macintosh') && Number(navigator.maxTouchPoints) > 1;
  if (!iPhone && !iPad) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter/.test(ua);
}

/* --------------------------------------------------------- loading state (2) */

function loadingHost() {
  return $('#view-search .view__inner') || $('.app') || document.body;
}

function buildSpinner() {
  const box = el('div', {
    class: 'stack',
    role: 'status',
    aria: { live: 'polite' },
    // There is no spinner class in the stylesheet's inventory, and inventing
    // one here would collide with the file another pair of hands owns.
    style: 'align-items: center; text-align: center; padding-top: var(--s10)',
  });

  if (!prefersReducedMotion()) {
    const ring = el('div', {
      aria: { hidden: 'true' },
      style: 'width: 28px; height: 28px; border-radius: var(--r-pill); '
        + 'border: 2px solid var(--line); border-top-color: var(--brand)',
    });
    // Transform only, never a layout property, and it stops with the element.
    if (typeof ring.animate === 'function') {
      ring.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: SPINNER_SPIN_MS, iterations: Infinity }
      );
    }
    box.appendChild(ring);
  }

  box.appendChild(el('p', {
    class: 'caption',
    text: str(['app.loading', 'ui.loading'], 'Getting the cookbook out...'),
  }));

  return box;
}

function startSpinner(host) {
  let node = null;
  const timer = setTimeout(() => {
    node = buildSpinner();
    host.appendChild(node);
  }, SPINNER_DELAY_MS);

  return () => {
    clearTimeout(timer);
    if (node) node.remove();
    node = null;
  };
}

/** Honest, friendly, and never a stack trace. The console gets the detail. */
function showLoadError(host, retry) {
  host.replaceChildren(el('div', { class: 'empty' }, [
    el('p', { class: 'empty__title' }, str(
      ['errors.load.title', 'app.loadErrorTitle'],
      'The cookbook did not open'
    )),
    el('p', {}, str(
      ['errors.load.body', 'app.loadErrorBody'],
      'Something got in the way of loading the food list. Have another go, and if this is the very first visit, it needs one moment of signal to save itself for later.'
    )),
    el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: str(['ui.buttons.tryAgain', 'ui.buttons.retry'], 'Try again'),
      on: { click: retry },
    }),
  ]));
}

/* ------------------------------------------------------------------ toast (4) */

let toastTimer = 0;

function hideToast() {
  const node = $('.toast');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }
  if (!node) return;
  node.classList.remove('is-open');
  node.hidden = true;
}

/**
 * The whole toast is the tap target, which is what "tap to update" promises and
 * what the stylesheet's :active scale expects. The button inside gives the same
 * action a name for VoiceOver, a focus ring, and a 44px target of its own.
 * duration 0 keeps it up: a toast that offers an action and then vanishes after
 * five seconds is a toast she can never act on.
 */
function showToast(message, { actionLabel = '', onAction = null, duration = TOAST_MS } = {}) {
  const node = $('.toast');
  if (!node) return;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }

  node.replaceChildren(el('span', { style: 'flex: 1', text: message }));

  if (typeof onAction === 'function') {
    node.appendChild(el('button', {
      type: 'button',
      text: actionLabel,
      style: 'min-height: 44px; padding: 0 var(--s2); border: 0; background: none; '
        + 'font-weight: 700; text-decoration: underline; text-underline-offset: 3px',
      on: {
        click: (event) => {
          event.stopPropagation();
          onAction();
        },
      },
    }));
    // Assigned, not added: the toast element is reused, and a stack of old
    // listeners on it would fire every update offer she has ever seen.
    node.onclick = () => onAction();
  } else {
    node.onclick = null;
  }

  node.hidden = false;
  node.classList.add('is-open');

  if (duration > 0) toastTimer = setTimeout(hideToast, duration);
}

/* --------------------------------------------------- service worker (4) */

/** Runs a post-render enhancement, keeping any failure to itself. */
function enhance(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[app] ${name} failed`, error);
  }
}

function registerServiceWorker() {
  // Truthiness, not an `in` check: some contexts expose the property with an
  // undefined value rather than leaving it off navigator entirely.
  if (!navigator.serviceWorker) return;

  // Resolved against this module, so the registration is right whether the site
  // is served from a domain root or from a /bump-appetit/ project subpath.
  let url;
  try {
    url = new URL('../../sw.js', import.meta.url);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;

  let pending = null;
  let accepted = false;
  let reloaded = false;

  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  const accept = () => {
    if (accepted) return;
    accepted = true;
    hideToast();
    if (pending) {
      pending.postMessage('SKIP_WAITING');
      setTimeout(reloadOnce, UPDATE_FALLBACK_MS);
      return;
    }
    reloadOnce();
  };

  const offer = (worker) => {
    if (!worker || accepted) return;
    pending = worker;
    showToast(
      str('ui.updateToast', 'Fresher guidance is ready - tap to update'),
      {
        actionLabel: str(['ui.buttons.update', 'ui.buttons.updateNow'], 'Update now'),
        onAction: accept,
        duration: 0,
      }
    );
  };

  // Never on its own: she might be mid-search, and yanking the page out from
  // under her is rude. Only a tap on the toast gets to move her, and only once.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted) return;
    reloadOnce();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    const type = event.data && event.data.type;
    if (type !== 'BA_UPDATE_READY') return;
    navigator.serviceWorker.getRegistration()
      .then((reg) => offer(reg && (reg.waiting || reg.installing)))
      .catch(() => {});
  });

  // Scope is left to default to the worker's own directory, which is the
  // project root wherever Pages happens to serve it from.
  navigator.serviceWorker.register(url.href).then((reg) => {
    if (!reg) return;

    // A worker already waiting from a previous visit still deserves the toast,
    // but only if something is actually controlling the page: with no
    // controller this is the first install, and there is nothing "fresher".
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      if (!next) return;
      next.addEventListener('statechange', () => {
        if (next.state !== 'installed') return;
        if (!navigator.serviceWorker.controller) return;
        offer(reg.waiting || next);
      });
    });
  }).catch((error) => {
    // No service worker means no offline mode. Everything else still works, so
    // this is a console note, not something she is ever told about.
    console.warn('[app] service worker did not register', error);
  });
}

/* ---------------------------------------------------------- footer (5) */

/**
 * One line per app open, not per view: seeing the same encouragement five times
 * in one session cheapens it. Rotating beats a random pick because two opens in
 * a row never repeat. If storage has been evicted the rotation simply starts
 * over, which is exactly as much as this should ever cost.
 */
function encouragementLine() {
  const lines = strList('encouragement');
  if (!lines.length) return '';

  const raw = Number(store.get(ENCOURAGEMENT_KEY, 0));
  const index = Number.isFinite(raw) ? ((raw % lines.length) + lines.length) % lines.length : 0;
  store.set(ENCOURAGEMENT_KEY, (index + 1) % lines.length);
  return lines[index];
}

let footerNode = null;

function buildFooter() {
  const line = encouragementLine();

  const link = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: str(['ui.buttons.howWeDecide', 'howWeDecide.title'], 'How we decide'),
    on: { click: (event) => openHowWeDecideSheet({ fromEl: event.currentTarget }) },
  });

  return el('footer', {
    class: 'disclaimer stack',
    // The stylesheet has no footer class, so the two spacing decisions this one
    // element needs are made here rather than by inventing a class in a file
    // this module does not own.
    style: '--stack-gap: var(--s3); margin-top: var(--s8)',
  }, [
    line ? el('p', {}, line) : null,
    el('p', {}, str('disclaimer', 'General info from Australian health sources, not medical advice. Always check with your midwife, OB or GP.')),
    // The button is inline-flex, so a plain wrapper lets the footer's centred
    // text alignment centre it without stretching it across the screen.
    el('div', {}, [link]),
  ]);
}

/** Moved rather than duplicated: one footer, always inside the visible view. */
/**
 * Pulls the deferred views in during idle time. requestIdleCallback is not on
 * iOS Safari yet, so a timeout stands in for it there.
 */
function warmWhenIdle(views) {
  const warm = () => views.forEach((view) => { view.ensure().catch(() => {}); });
  if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1200);
}

function placeFooter(viewEl) {
  if (!footerNode || !viewEl) return;
  const inner = $('.view__inner', viewEl) || viewEl;
  inner.appendChild(footerNode);
}

/* -------------------------------------------------------- keyboard (7.4) */

/**
 * iOS resizes the visual viewport rather than the layout viewport when the
 * keyboard comes up, and it scrolls the page to keep the caret visible. That
 * can leave the results list halfway down the screen, so when the keyboard
 * opens on the search field the list goes back to the top where she left it.
 */
function wireKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;

  const settle = () => {
    if (vv.height >= window.innerHeight - KEYBOARD_MIN_PX) return;

    const active = document.activeElement;
    if (!active || typeof active.closest !== 'function' || !active.closest('.searchbar')) return;

    const results = $('.results');
    if (results) results.scrollTop = 0;
    window.scrollTo(0, 0);
  };

  vv.addEventListener('resize', () => onceRaf(settle));
}

/* ---------------------------------------------------- install hint (6, 7.4) */

function maybeShowInstallHint(standalone) {
  if (standalone) return;
  if (!isIosSafari()) return;
  if (store.get(HINT_KEY, false) === true) return;

  const node = $('.install-hint');
  if (!node) return;

  const dismiss = () => {
    store.set(HINT_KEY, true);
    node.classList.remove('is-open');
    node.hidden = true;
    document.removeEventListener('pointerdown', onOutside, true);
  };

  // The hint is a fixed card floating over the bottom of every screen, which
  // makes it a dead zone for anything underneath: real taps on real results
  // were dying on it. So the first tap anywhere OUTSIDE the card dismisses it,
  // at capture phase on pointerdown. By the time that same tap's click event
  // hit-tests, the card is gone, so the tap still lands on the thing she was
  // actually aiming at. The hint gets seen once and never costs her a tap.
  const onOutside = (event) => {
    if (node.contains(event.target)) return;
    dismiss();
  };
  document.addEventListener('pointerdown', onOutside, true);

  const body = el('div', { class: 'stack', style: '--stack-gap: var(--s2); flex: 1' }, [
    el('p', { style: 'font-weight: 700' }, str('ui.installHint.title', 'Make me an app')),
    el('p', {}, str('ui.installHint.text', "Tap the Share button, then 'Add to Home Screen'.")),
    el('div', {}, [
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: str(['ui.installHint.dismiss', 'ui.buttons.dismiss'], 'Maybe later'),
        on: { click: dismiss },
      }),
    ]),
  ]);

  const glyph = iconNode('share', 24);
  node.replaceChildren(...(glyph ? [glyph, body] : [body]));
  node.hidden = false;
  node.classList.add('is-open');
}

/* ------------------------------------------------------------------ boot */

let started = false;

async function boot() {
  const host = loadingHost();
  const stop = startSpinner(host);

  let bundle;
  try {
    bundle = await loadData();
  } catch (error) {
    stop();
    // The detail is for Ryan in the console. She gets a sentence and a button.
    console.error('[app] data load failed', error);
    showLoadError(host, () => {
      host.replaceChildren();
      boot();
    });
    return;
  }
  stop();

  initSearch(bundle.foods);

  // Everything past here runs once. A retry after a failed load re-enters boot,
  // and building the views and the router twice would double every listener.
  if (started) return;
  started = true;

  const ctx = {
    data: bundle,
    strings: STRINGS,
    config: CONFIG,
    go,
    openSheet,
    openFoodSheet,
    // Filled in once the Search view is built, since it owns the list.
    browseNutrient: null,
  };

  // Tapping "Folate high" on a verdict sheet asks "what else has this?", and
  // the Search screen is what answers. Routed through ctx so the sheet never
  // has to reach into a view, and so a nutrient jump also switches tab.
  setNutrientBrowser((key) => {
    go('search');
    if (typeof ctx.browseNutrient === 'function') ctx.browseNutrient(key);
  });

  /**
   * A stand-in for a view whose module has not loaded yet. It hands the router
   * the empty shell index.html already ships, then fills that same shell in
   * once the real module arrives, so the router never knows the difference.
   *
   * The service worker precaches every module, so this stays a local read and
   * keeps working in flight mode.
   */
  function lazyView(id, load) {
    const el = $(`#view-${id}`);
    if (!el) return null;

    let real = null;
    let pending = null;

    const ensure = () => {
      if (real) return Promise.resolve(real);
      if (!pending) {
        pending = load()
          .then((make) => {
            // The factories reuse the shell by id, so this populates the very
            // element the router is already showing.
            real = (typeof make === 'function' ? make(ctx) : null) || null;
            // Only reclaim the footer when this view is the one on screen. The
            // idle warm-up loads views in the background, and moving the single
            // shared footer into a hidden view would strip it off the screen
            // she is actually looking at.
            if (el.classList.contains('is-active')) placeFooter(el);
            return real;
          })
          .catch((err) => {
            pending = null; // a later tap gets a fresh go rather than a dead tab
            throw err;
          });
      }
      return pending;
    };

    return {
      id,
      el,
      ensure,
      onEnter() {
        ensure().then((view) => { if (view && view.onEnter) view.onEnter(); }, () => {});
      },
      onLeave() {
        if (real && real.onLeave) real.onLeave();
      },
    };
  }

  const lazies = [
    lazyView('scan', () => import('./views/scan.js').then((m) => m.createScanView)),
    lazyView('bites', () => import('./views/bites.js').then((m) => m.createBitesView)),
    lazyView('more', () => import('./views/more.js').then((m) => m.createMoreView)),
  ].filter(Boolean);

  const views = [createSearchView(ctx), ...lazies].filter(Boolean);

  initRouter({
    views,
    onEnter: (id, view) => placeFooter(view.el),
  });

  // Warm the other three once the first screen is done, so tapping a tab is
  // instant rather than waiting on a fetch she is watching.
  warmWhenIdle(lazies);

  // The app is usable from here. Everything below is enhancement, so each piece
  // fails on its own rather than taking the screen down with it: boot's catch
  // replaces the page with an error card, and doing that to an app that has
  // already rendered a verdict would be a far worse bug than a missing footer.
  enhance('service worker', registerServiceWorker);

  enhance('footer', () => {
    footerNode = buildFooter();
    placeFooter($('.view.is-active') || (views[0] && views[0].el));
  });

  enhance('install hint', () => maybeShowInstallHint(isStandalone()));

  enhance('keyboard', wireKeyboard);

  enhance('touch resilience', wireTapFallback);
}

/**
 * Some embedded contexts (sandboxed iframes among them) deliver touch and
 * pointer events but never synthesise the mouse events that follow a tap.
 * Every control in this app activates on 'click', so in those contexts a tap
 * lands, does nothing, and the app reads as broken.
 *
 * The fallback: after a clean touch pointerup, wait a beat for the native
 * click. If it never comes, dispatch one at the same spot. Environments that
 * synthesise clicks normally never see this fire, because the native click
 * always arrives first.
 */
function wireTapFallback() {
  const WAIT_MS = 120;      // native synthesis lands within a few ms when it exists
  const SLOP_PX = 12;       // more movement than this is a scroll, not a tap
  const DEDUPE_MS = 400;

  let down = null;
  let lastClickAt = -Infinity;   // any click, native or synthetic
  let synthAt = -Infinity;       // synthetic clicks only

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    down = { x: event.clientX, y: event.clientY };
  }, true);

  document.addEventListener('pointercancel', () => { down = null; }, true);

  document.addEventListener('click', (event) => {
    if (event.__baSynthetic) {
      lastClickAt = performance.now();
      return;
    }
    // A real click arriving hot on the heels of a synthetic one is the same
    // tap counted twice: swallow it.
    if (performance.now() - synthAt < DEDUPE_MS) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    lastClickAt = performance.now();
  }, true);

  document.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary || !down) return;
    const start = down;
    down = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) return;

    const upAt = performance.now();
    const x = event.clientX;
    const y = event.clientY;
    setTimeout(() => {
      if (lastClickAt >= upAt) return;   // the native click showed up, all good
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      synthAt = performance.now();
      const synthetic = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      });
      synthetic.__baSynthetic = true;
      target.dispatchEvent(synthetic);
    }, WAIT_MS);
  }, true);
}

/* Standalone detection first, so the very first paint already knows whether it
   is a website or her app. Everything else waits for data. */
markStandalone();
applyStringHooks(document);

// She can add the app to her home screen at any point, including with the tab
// still open behind it.
try {
  const query = window.matchMedia('(display-mode: standalone)');
  const onChange = () => markStandalone();
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
} catch {
  // No matchMedia change events here, which only costs a class until reload.
}

boot().catch((error) => {
  // A blank screen is the one failure she can do nothing about, so even an
  // unexpected one ends in a sentence and a button rather than in nothing.
  console.error('[app] bootstrap failed', error);
  showLoadError(loadingHost(), () => window.location.reload());
});
