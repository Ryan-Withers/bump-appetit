// The generic bottom sheet: verdicts, recipes, trackers, cheat sheets, Oops.
//
// One sheet element is reused for every caller. Opening a second sheet swaps
// the contents rather than stacking, so the history stack stays one entry deep
// and a single back gesture always lands on the view behind it.

import { STRINGS } from './strings.js';
import { $, $$, el, prefersReducedMotion, clamp } from './util.js';
import { icon } from './icons.js';
import { pushSheet } from './router.js';

const OPEN_MS = 380;
const CLOSE_MS = 240;
const BACKDROP_MS = 240;
const SPRING_BACK_MS = 260;
const REDUCED_MS = 150;
const SWAP_MS = 120;

const DISMISS_RATIO = 0.3;      // of sheet height
const DISMISS_VELOCITY = 0.6;   // px per ms
const MIN_FLING_PX = 24;        // a twitch is never a flick, however fast
const MIN_SAMPLE_MS = 8;        // shorter spans are noise, not speed
const DRAG_SLOP_PX = 6;
const HEADER_ZONE_PX = 72;      // handle plus the title row above the body
const SAMPLE_WINDOW_MS = 120;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let dom = null;
let open = false;
let current = null;   // { id, label, onClose }
let opener = null;    // element focus returns to
let openedAt = 0;     // when the current open animation began
let lock = null;      // saved body styles plus scroll offset
let drag = null;
let generation = 0;

const running = new WeakMap();
const tokenCache = new Map();

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

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

function safely(fn) {
  if (typeof fn !== 'function') return;
  try {
    fn();
  } catch (error) {
    console.error('[sheet]', error);
  }
}

/** onClose keeps its own options object as `this`, in case a caller wrote it
 *  as a method rather than an arrow function. */
function fireClose(entry) {
  if (!entry || typeof entry.onClose !== 'function') return;
  safely(() => entry.onClose.call(entry.source));
}

/* ------------------------------------------------------------------- DOM */

function ensureDom() {
  if (dom) return dom;

  const host = $('#sheet-host') || $('[data-sheet-host]') || document.body;

  let backdrop = $('.sheet-backdrop');
  if (!backdrop) {
    backdrop = el('div', { class: 'sheet-backdrop' });
    host.appendChild(backdrop);
  }

  let sheet = $('.sheet');
  if (!sheet) {
    sheet = el('section', { class: 'sheet' });
    host.appendChild(sheet);
  }
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('tabindex', '-1');

  let handle = $('.sheet__handle', sheet);
  if (!handle) {
    handle = el('div', { class: 'sheet__handle', aria: { hidden: 'true' } });
    sheet.prepend(handle);
  }
  // Functional, not cosmetic: without it Safari claims the gesture for
  // scrolling before the first pointermove ever reaches us.
  handle.style.touchAction = 'none';

  let close = $('.sheet__close', sheet);
  if (!close) {
    close = el('button', {
      class: 'sheet__close',
      type: 'button',
      aria: { label: str('sheet.close', 'Close') },
      html: icon('x', { size: 24 }),
    });
    handle.after(close);
  }

  let body = $('.sheet__body', sheet);
  if (!body) {
    body = el('div', { class: 'sheet__body' });
    sheet.appendChild(body);
  }

  dom = { backdrop, sheet, handle, close, body };
  hideChrome();

  close.addEventListener('click', () => closeSheet());
  backdrop.addEventListener('click', () => {
    // An impatient double-tap lands its second tap on the backdrop while the
    // sheet is still flying up, and closing on it makes the sheet flash and
    // vanish. During the open flight a backdrop tap is noise, not intent.
    if (performance.now() - openedAt < OPEN_MS + 60) return;
    closeSheet();
  });
  sheet.addEventListener('pointerdown', onPointerDown);
  sheet.addEventListener('pointermove', onPointerMove);
  sheet.addEventListener('pointerup', onPointerUp);
  sheet.addEventListener('pointercancel', onPointerUp);

  return dom;
}

// The stylesheet hides both boxes with visibility rather than display, so they
// stay laid out and have something to animate from. Toggling the attribute and
// the class is the whole contract: forcing display:none over the top would take
// that away.
function hideChrome() {
  dom.sheet.classList.remove('is-open');
  dom.sheet.hidden = true;
  dom.backdrop.hidden = true;
}

function showChrome() {
  dom.backdrop.hidden = false;
  dom.sheet.hidden = false;
  dom.sheet.classList.add('is-open');
}

/* --------------------------------------------------------- body scroll lock */

function lockScroll() {
  if (lock) return;
  const body = document.body;
  const y = window.scrollY || document.documentElement.scrollTop || 0;

  lock = {
    y,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };

  // position:fixed with a negative top is the one iOS-proof lock. Painting it
  // at -y keeps the page exactly where it was, so there is no jump.
  body.style.position = 'fixed';
  body.style.top = `-${y}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
}

function unlockScroll() {
  if (!lock) return;
  const body = document.body;
  body.style.position = lock.position || '';
  body.style.top = lock.top || '';
  body.style.left = lock.left || '';
  body.style.right = lock.right || '';
  body.style.width = lock.width || '';
  window.scrollTo(0, lock.y);
  lock = null;
}

/* ------------------------------------------------------------ focus trap */

function focusables() {
  // getClientRects rather than offsetParent: the sheet is position:fixed, and
  // offsetParent lies about anything inside a fixed box.
  return $$(FOCUSABLE, dom.sheet).filter((node) => node.getClientRects().length > 0);
}

function onKeyDown(event) {
  if (!open) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeSheet();
    return;
  }
  if (event.key !== 'Tab') return;

  const items = focusables();
  if (!items.length) {
    event.preventDefault();
    dom.sheet.focus({ preventScroll: true });
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = dom.sheet.contains(active) && active !== dom.sheet;

  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

function restoreFocus() {
  const target = opener && opener.isConnected ? opener : null;
  opener = null;
  if (target) target.focus({ preventScroll: true });
  else if (document.activeElement && dom.sheet.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

/* ----------------------------------------------------------- drag to dismiss */

function preventTouch(event) {
  if (event.cancelable) event.preventDefault();
}

function bodyAtTop() {
  return dom.body.scrollTop <= 0;
}

function inHeaderZone(event) {
  const rect = dom.sheet.getBoundingClientRect();
  return event.clientY - rect.top <= HEADER_ZONE_PX;
}

function pushSample(sample, y) {
  sample.samples.push({ t: performance.now(), y });
  if (sample.samples.length > 6) sample.samples.shift();
}

/** Velocity from the tail of the gesture only: a slow drag that ends in a
 *  flick should dismiss, and the average over the whole drag would hide that. */
function velocityOf(sample) {
  const samples = sample.samples;
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    first = samples[i];
    if (last.t - samples[i].t >= SAMPLE_WINDOW_MS) break;
  }
  const dt = last.t - first.t;
  // Coalesced moves can share a timestamp, and dividing by that gives a
  // nonsense flick speed. Fall back to the distance test instead.
  if (dt < MIN_SAMPLE_MS) return 0;
  return (last.y - first.y) / dt;
}

/**
 * A finger-tracked transform must not go through a CSS transition, or the
 * sheet lags behind the thumb. Suspended for the drag, restored after it.
 */
function suspendTransitions(off) {
  const value = off ? 'none' : '';
  dom.sheet.style.transition = value;
  dom.backdrop.style.transition = value;
}

function applyDrag(dy) {
  dom.sheet.style.transform = `translateY(${dy.toFixed(1)}px)`;
  const height = dom.sheet.getBoundingClientRect().height || 1;
  dom.backdrop.style.opacity = String(clamp(1 - (dy / height) * 0.9, 0.2, 1));
}

function endTouchGuard() {
  document.removeEventListener('touchmove', preventTouch, { passive: false });
}

function cancelDrag() {
  if (!drag) return;
  if (drag.grabbed) {
    endTouchGuard();
    try {
      dom.sheet.releasePointerCapture(drag.id);
    } catch {
      // The pointer is already gone, which is exactly what we wanted.
    }
  }
  drag = null;
}

function onPointerDown(event) {
  if (!open || drag) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const target = event.target;
  // Controls win: a heart tap or a variant row must never read as a drag.
  if (target && typeof target.closest === 'function'
    && target.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;

  drag = {
    id: event.pointerId,
    startY: event.clientY,
    originY: event.clientY,
    dy: 0,
    decided: false,
    grabbed: false,
    fromHeader: (target && typeof target.closest === 'function' && !!target.closest('.sheet__handle'))
      || inHeaderZone(event),
    samples: [],
  };
  pushSample(drag, event.clientY);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  pushSample(drag, event.clientY);

  if (!drag.decided) {
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) < DRAG_SLOP_PX) return;

    // A downward drag only grabs the sheet from the handle and header, or from
    // a body that is already scrolled to the top. Anything else is a scroll.
    drag.decided = true;
    drag.grabbed = delta > 0 && (drag.fromHeader || bodyAtTop());
    if (!drag.grabbed) {
      drag = null;
      return;
    }

    drag.originY = event.clientY;   // no jump from the slop we just spent
    suspendTransitions(true);
    try {
      dom.sheet.setPointerCapture(drag.id);
    } catch {
      // Capture is a nicety, the gesture still tracks without it.
    }
    document.addEventListener('touchmove', preventTouch, { passive: false });
    return;
  }

  if (!drag.grabbed) return;
  const delta = event.clientY - drag.originY;
  drag.dy = delta > 0 ? delta : delta * 0.25;   // resistance upward
  if (event.cancelable) event.preventDefault();
  applyDrag(drag.dy);
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;

  const gesture = drag;
  cancelDrag();
  if (!gesture.grabbed) return;

  // A cancelled pointer (a system gesture stole it) is not a decision to
  // dismiss, so it always springs back.
  if (event.type === 'pointercancel') {
    springBack();
    return;
  }

  const height = dom.sheet.getBoundingClientRect().height || 1;
  const flung = gesture.dy > MIN_FLING_PX && velocityOf(gesture) > DISMISS_VELOCITY;
  if (gesture.dy > height * DISMISS_RATIO || flung) {
    closeSheet();
    return;
  }
  springBack();
}

function springBack() {
  const reduced = prefersReducedMotion();
  const settle = () => {
    dom.sheet.style.transform = '';
    dom.backdrop.style.opacity = '1';
    suspendTransitions(false);
  };

  if (reduced) {
    settle();
    return;
  }

  // One keyframe: the animation starts from wherever the finger left the sheet.
  const anim = animateNode(dom.sheet, [{ transform: 'translateY(0)' }], {
    duration: SPRING_BACK_MS,
    easing: spring(),
    fill: 'forwards',
  });
  animateNode(dom.backdrop, [{ opacity: 1 }], { duration: SPRING_BACK_MS, easing: easeOut() });

  if (anim) {
    anim.addEventListener('finish', () => {
      anim.cancel();
      settle();
    });
  } else {
    settle();
  }
}

/* ------------------------------------------------------------------- API */

export function openSheet(options = {}) {
  const { id = 'sheet', label = '', build, onClose, fromEl } = options;
  ensureDom();
  cancelDrag();

  const wasOpen = open;
  const previous = current;
  generation += 1;

  // The sheet being replaced still needs its teardown, even though the element
  // stays on screen.
  if (wasOpen) fireClose(previous);
  if (!wasOpen) {
    opener = fromEl || (document.activeElement !== document.body ? document.activeElement : null);
  }

  current = { id, label, onClose, source: options };
  dom.sheet.setAttribute('aria-label', label || str('sheet.label', 'Details'));
  dom.body.replaceChildren();
  dom.body.scrollTop = 0;
  if (typeof build === 'function') safely(() => build(dom.body));

  pushSheet(id);

  const reduced = prefersReducedMotion();

  if (wasOpen) {
    // A replacement, not a new sheet: keep it on screen, just refresh it.
    dom.sheet.style.transform = 'translateY(0)';
    animateNode(dom.body, [{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_MS, easing: easeOut() });
    dom.sheet.focus({ preventScroll: true });
    return dom.sheet;
  }

  open = true;
  openedAt = performance.now();
  // A fresh open must also undo the close path's immediate inerting below.
  dom.backdrop.style.pointerEvents = '';
  lockScroll();
  suspendTransitions(false);
  showChrome();
  // The resting state is written inline rather than left to the stylesheet, so
  // the sheet cannot snap back down when the open animation hands over.
  dom.sheet.style.transform = 'translateY(0)';
  dom.backdrop.style.opacity = '1';

  // The body stays put until the sheet has landed, so an eager thumb cannot
  // scroll content that is still flying up the screen.
  dom.body.style.overflowY = 'hidden';

  animateNode(dom.backdrop, [{ opacity: 0 }, { opacity: 1 }], {
    duration: reduced ? REDUCED_MS : BACKDROP_MS,
    easing: easeOut(),
  });

  const frames = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
  const anim = animateNode(dom.sheet, frames, {
    duration: reduced ? REDUCED_MS : OPEN_MS,
    easing: reduced ? easeOut() : spring(),
  });

  const settled = () => {
    dom.body.style.overflowY = '';
    dom.sheet.dispatchEvent(new CustomEvent('sheet:opened', { detail: { id } }));
  };
  if (anim) anim.addEventListener('finish', settled);
  else settled();

  document.addEventListener('keydown', onKeyDown);
  dom.sheet.focus({ preventScroll: true });

  return dom.sheet;
}

export function closeSheet({ fromHistory = false } = {}) {
  if (!open || !dom) return;

  open = false;
  // Inert from the first frame of the close, not from settle(): the hidden
  // attribute only lands when the animation finishes, and until then the
  // fading backdrop was still eating the tap that follows a close.
  dom.backdrop.style.pointerEvents = 'none';
  const closing = current;
  current = null;
  cancelDrag();
  document.removeEventListener('keydown', onKeyDown);

  const token = ++generation;
  const reduced = prefersReducedMotion();

  const frames = reduced ? [{ opacity: 0 }] : [{ transform: 'translateY(100%)' }];
  const anim = animateNode(dom.sheet, frames, {
    duration: reduced ? REDUCED_MS : CLOSE_MS,
    easing: easeOut(),
    fill: 'forwards',
  });
  const backdropAnim = animateNode(dom.backdrop, [{ opacity: 0 }], {
    duration: reduced ? REDUCED_MS : BACKDROP_MS,
    easing: easeOut(),
    fill: 'forwards',
  });

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (token !== generation) return;   // a new sheet opened mid-close
    // Park the inline values on the closed state BEFORE releasing the
    // animations. Otherwise the browser can see the underlying open values
    // reappear for one frame and run the stylesheet's close transition all
    // over again, which reads as the sheet shutting twice.
    dom.sheet.style.transform = 'translateY(100%)';
    dom.backdrop.style.opacity = '0';
    if (anim) anim.cancel();
    if (backdropAnim) backdropAnim.cancel();
    hideChrome();
    suspendTransitions(false);
    dom.sheet.style.transform = '';
    dom.sheet.style.opacity = '';
    dom.backdrop.style.opacity = '';
    dom.body.style.overflowY = '';
    dom.body.replaceChildren();
  };
  if (anim) anim.addEventListener('finish', settle);
  else settle();
  // The finish event can arrive late when the page is busy animating, and
  // until settle runs the invisible backdrop is still eating taps. The timer
  // puts a hard ceiling on that window; settle itself only ever runs once.
  setTimeout(settle, (reduced ? REDUCED_MS : CLOSE_MS) + 80);

  unlockScroll();
  restoreFocus();
  fireClose(closing);

  // A close that came from popstate has already spent its history entry.
  // Calling back() again here is the classic double-back bug.
  if (!fromHistory) history.back();
}

export function isSheetOpen() {
  return open;
}
