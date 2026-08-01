// Four views, one history stack, no page loads ever.
//
// The history wiring is the whole point of this file. An installed iOS PWA has
// no browser chrome, so the edge-swipe-back gesture is the only back button
// Emma has. Every view switch and every open sheet is a real history entry,
// which makes that swipe close a sheet first and step back a view second,
// exactly like a native app.

import { STRINGS } from './strings.js';
import { $, $$, el, prefersReducedMotion } from './util.js';
import { icon } from './icons.js';
import { closeSheet, isSheetOpen } from './sheet.js';

const FADE_MS = 200;
const OVERLAP_MS = 60;
const REDUCED_MS = 150;   // the reduced-motion ceiling, and what the CSS uses
const POP_MS = 260;
const DRIFT_PX = 6;
const HOME_VIEW = 'search';

const TAB_ICONS = Object.freeze({
  search: 'search',
  scan: 'camera',
  bites: 'cookie',
  more: 'menu',
});

let views = [];
let byId = new Map();
let tabs = [];
let hooks = {};
let activeId = null;
let swapTimer = 0;
let pendingSwap = null;

const scrollTops = new Map();
const running = new WeakMap();
const tokenCache = new Map();

/** Reads a string by dot path so a missing key degrades instead of throwing. */
function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

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
const spring = () => cssToken('--spring', 'cubic-bezier(.34,1.56,.64,1)');

/** One animation per node at a time, so rapid taps never leave a half-faded view. */
function animateNode(node, frames, options) {
  if (!node || typeof node.animate !== 'function') return null;
  const previous = running.get(node);
  if (previous) previous.cancel();

  const animation = node.animate(frames, options);
  running.set(node, animation);
  animation.addEventListener('finish', () => {
    if (running.get(node) === animation) running.delete(node);
  });
  return animation;
}

function viewFromHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '').trim();
  return byId.has(raw) ? raw : '';
}

function defaultViewId() {
  if (byId.has(HOME_VIEW)) return HOME_VIEW;
  return views.length ? views[0].id : '';
}

function panelId(view) {
  if (!view.el.id) view.el.id = `view-${view.id}`;
  return view.el.id;
}

function tabId(entry) {
  if (!entry.node.id) entry.node.id = `tab-${entry.viewId}`;
  return entry.node.id;
}

function showView(view) {
  view.el.hidden = false;
  view.el.style.display = '';
  view.el.classList.add('is-active');
}

function hideView(view) {
  view.el.classList.remove('is-active');
  view.el.hidden = true;
  // Inline display wins over whatever the stylesheet says, so a panel is never
  // left visible if .view happens to be a flex or grid box.
  view.el.style.display = 'none';
}

/** The view scrolls itself when it is an overflow box, otherwise the document does. */
function scrollerFor(view) {
  const node = view.el;
  try {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
  } catch {
    return null;
  }
  return null;
}

function saveScroll(view) {
  const scroller = scrollerFor(view);
  scrollTops.set(view.id, scroller ? scroller.scrollTop : window.scrollY || 0);
}

function restoreScroll(view) {
  const y = scrollTops.get(view.id) || 0;
  const scroller = scrollerFor(view);
  if (scroller) scroller.scrollTop = y;
  else window.scrollTo(0, y);
}

function scrollToTop(view) {
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  const scroller = scrollerFor(view);
  scrollTops.set(view.id, 0);
  if (scroller) scroller.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

/** A view hook is called as a method, so a view written with `this` still works. */
function callHook(owner, name, ...args) {
  const fn = owner && owner[name];
  if (typeof fn !== 'function') return;
  try {
    fn.apply(owner, args);
  } catch (error) {
    console.error('[router]', error);
  }
}

function enterHooks(view) {
  callHook(view, 'onEnter', view);
  callHook(hooks, 'onEnter', view.id, view);
}

function leaveHooks(view) {
  callHook(view, 'onLeave', view);
  callHook(hooks, 'onLeave', view.id, view);
}

/* ---------------------------------------------------------------- tab bar */

function tabViewId(node) {
  const fromAria = (node.getAttribute('aria-controls') || '').replace(/^view[-_]?/, '');
  const fromHref = (node.getAttribute('href') || '').replace(/^#\/?/, '');
  const raw = String(node.dataset.view || node.dataset.tab || fromAria || fromHref || '').trim();
  return byId.has(raw) ? raw : '';
}

function collectTabs(bar) {
  const found = [];
  const seen = new Set();
  for (const node of $$('[data-view], [data-tab], [role="tab"], .tab, a[href^="#"]', bar)) {
    const viewId = tabViewId(node);
    if (!viewId || seen.has(viewId)) continue;
    seen.add(viewId);
    found.push({ node, viewId });
  }
  return found;
}

function buildTabs(bar) {
  const built = [];
  for (const view of views) {
    const label = str(`tabs.${view.id}`, view.id.charAt(0).toUpperCase() + view.id.slice(1));
    const node = el('button', { class: 'tab', type: 'button', data: { view: view.id } }, [
      el('span', { class: 'tab__icon', html: icon(TAB_ICONS[view.id] || 'circle-check', { size: 24 }) }),
      el('span', { class: 'tab__label', text: label }),
    ]);
    bar.appendChild(node);
    built.push({ node, viewId: view.id });
  }
  return built;
}

function wireTabs() {
  let bar = $('.tabbar') || $('[role="tablist"]') || $('[data-tabbar]');
  if (!bar) {
    bar = el('nav', { class: 'tabbar' });
    document.body.appendChild(bar);
  }

  bar.setAttribute('role', 'tablist');
  if (!bar.getAttribute('aria-label')) {
    bar.setAttribute('aria-label', str('a11y.tabs', 'Sections'));
  }

  tabs = collectTabs(bar);
  if (!tabs.length) tabs = buildTabs(bar);

  for (const entry of tabs) {
    const view = byId.get(entry.viewId);
    entry.node.setAttribute('role', 'tab');
    entry.node.setAttribute('aria-controls', panelId(view));
    entry.node.setAttribute('aria-selected', 'false');
    entry.node.setAttribute('tabindex', '-1');
    if (!entry.node.dataset.view) entry.node.dataset.view = entry.viewId;
    view.el.setAttribute('aria-labelledby', tabId(entry));

    entry.node.addEventListener('click', (event) => {
      event.preventDefault();
      go(entry.viewId);
    });
  }

  bar.addEventListener('keydown', onTabKeydown);
}

function onTabKeydown(event) {
  const index = tabs.findIndex((entry) => entry.node === event.target || entry.node.contains(event.target));
  if (index < 0 || !tabs.length) return;

  let next = -1;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  if (next < 0) return;

  event.preventDefault();
  tabs[next].node.focus();
  go(tabs[next].viewId);
}

function popTabIcon(node) {
  const target = $('.tab__icon', node) || $('svg', node);
  if (!target) return;

  if (prefersReducedMotion()) {
    // The stylesheet pops the icon whenever .is-active lands. Holding the
    // resting scale across that window is how the router keeps reduced motion
    // genuinely still without the stylesheet needing to know.
    animateNode(target, [{ transform: 'scale(1)' }, { transform: 'scale(1)' }], { duration: POP_MS });
    return;
  }

  animateNode(target, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.18)', offset: 0.5 },
    { transform: 'scale(1)' },
  ], { duration: POP_MS, easing: spring() });
}

function syncTabs(id, { pop = true } = {}) {
  for (const entry of tabs) {
    const on = entry.viewId === id;
    entry.node.classList.toggle('is-active', on);
    entry.node.setAttribute('aria-selected', on ? 'true' : 'false');
    entry.node.setAttribute('tabindex', on ? '0' : '-1');
    if (on && pop) popTabIcon(entry.node);
  }
}

/* ------------------------------------------------------------ transitions */

function finishSwap() {
  if (swapTimer) {
    clearTimeout(swapTimer);
    swapTimer = 0;
  }
  if (pendingSwap) pendingSwap();
}

function enter(view, { animate }) {
  showView(view);
  enterHooks(view);
  // After onEnter, because a view that renders on entry is not its full height
  // until it has.
  restoreScroll(view);
  if (!animate) return;

  if (prefersReducedMotion()) {
    animateNode(view.el, [{ opacity: 0 }, { opacity: 1 }], {
      duration: REDUCED_MS,
      easing: 'linear',
    });
    return;
  }

  // The stylesheet fades .view.is-active in as well, on a 60ms delay. This runs
  // over that whole window and holds the resting state through the tail, so the
  // two never disagree about the last frame.
  animateNode(view.el, [
    { opacity: 0, transform: `translateY(${DRIFT_PX}px)`, offset: 0 },
    { opacity: 1, transform: 'translateY(0)', offset: FADE_MS / (FADE_MS + OVERLAP_MS) },
    { opacity: 1, transform: 'translateY(0)', offset: 1 },
  ], { duration: FADE_MS + OVERLAP_MS, easing: easeOut() });
}

function activate(nextId, { animate = true } = {}) {
  finishSwap();

  const next = byId.get(nextId);
  if (!next) return;

  const prev = activeId && activeId !== nextId ? byId.get(activeId) : null;
  const first = !activeId;
  activeId = nextId;
  syncTabs(nextId, { pop: !first });

  if (!prev) {
    enter(next, { animate: animate && !first });
    return;
  }

  saveScroll(prev);
  leaveHooks(prev);

  if (!animate) {
    hideView(prev);
    enter(next, { animate: false });
    return;
  }

  const reduced = prefersReducedMotion();
  const outMs = reduced ? REDUCED_MS : FADE_MS;
  const overlap = reduced ? Math.round(REDUCED_MS / 2) : OVERLAP_MS;
  const outFrames = reduced
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: `translateY(${DRIFT_PX}px)` },
    ];

  prev.el.style.pointerEvents = 'none';
  animateNode(prev.el, outFrames, { duration: outMs, easing: easeOut(), fill: 'forwards' });

  // The incoming view takes over with the outgoing one still mid-fade, which
  // is the 60ms overlap. Only one panel is ever in normal flow though: two
  // would double the page height for those 60ms and the layout would lurch.
  pendingSwap = () => {
    pendingSwap = null;
    const out = running.get(prev.el);
    if (out) out.cancel();
    prev.el.style.pointerEvents = '';
    hideView(prev);
    enter(next, { animate: true });
  };

  swapTimer = setTimeout(() => {
    swapTimer = 0;
    if (pendingSwap) pendingSwap();
  }, Math.max(0, outMs - overlap));
}

/* ------------------------------------------------------------------- API */

export function initRouter({ views: list = [], onEnter, onLeave } = {}) {
  views = list.filter((view) => view && view.id && view.el);
  byId = new Map(views.map((view) => [view.id, view]));
  hooks = { onEnter, onLeave };
  if (!views.length) return;

  const host = $('#views') || $('.app') || document.body;
  const bar = $('.tabbar', host);

  for (const view of views) {
    view.el.classList.add('view');
    view.el.setAttribute('role', 'tabpanel');
    view.el.setAttribute('tabindex', '-1');
    panelId(view);
    if (!view.el.isConnected) {
      if (bar && bar.parentNode === host) host.insertBefore(view.el, bar);
      else host.appendChild(view.el);
    }
    hideView(view);
  }

  // index.html ships empty view shells. If a view module hands us a fresh
  // element instead of reusing its shell, the shell would sit there active and
  // blank, so anything no registered view claims gets put away.
  for (const node of $$('.view')) {
    const claimed = views.some((view) => view.el === node
      || view.el.contains(node) || node.contains(view.el));
    if (!claimed) {
      node.classList.remove('is-active');
      node.hidden = true;
      node.style.display = 'none';
    }
  }

  wireTabs();

  // We own scroll restoration per view, so the browser must not also guess.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  window.addEventListener('popstate', onPopState);

  const initial = viewFromHash() || defaultViewId();
  // replaceState, not pushState: the first entry should BE the first view, not
  // sit on top of a duplicate.
  history.replaceState({ view: initial }, '', `#${initial}`);
  activate(initial, { animate: false });
}

function onPopState(event) {
  const state = event.state || {};

  // A back gesture with a sheet up closes the sheet and nothing else. This is
  // the single most app-feeling behaviour in the build.
  if (isSheetOpen()) {
    closeSheet({ fromHistory: true });
    return;
  }

  const target = byId.has(state.view) ? state.view : (viewFromHash() || defaultViewId());
  go(target, { push: false });
}

export function go(viewId, { push = true } = {}) {
  if (!byId.has(viewId)) return;

  if (isSheetOpen()) {
    // Closing without history.back(): we are about to push a view entry, and
    // two navigations racing each other is how double-backs get born.
    closeSheet({ fromHistory: true });
    replaceStateForSheetClose();
  }

  if (viewId === activeId) {
    // Tapping the tab you are already on scrolls to the top, the way a native
    // app does. A back gesture landing on the same view must not, or every
    // sheet close would throw her results list back to the start.
    if (push) scrollToTop(byId.get(viewId));
    return;
  }

  if (push) history.pushState({ view: viewId }, '', `#${viewId}`);
  activate(viewId, { animate: true });
}

export function currentView() {
  return activeId;
}

export function pushSheet(id) {
  const state = { view: activeId, sheet: String(id || 'sheet') };
  const now = history.state || {};
  // Swapping one sheet for another replaces the entry. Stacking them would
  // make a single back press land on the sheet she just left.
  if (now.sheet) history.replaceState(state, '');
  else history.pushState(state, '');
}

export function replaceStateForSheetClose() {
  const now = history.state || {};
  if (!now.sheet) return;
  history.replaceState({ view: activeId || now.view || defaultViewId() }, '');
}
