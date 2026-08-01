// The verdict sticker: a little oval like the ones stuck on apples and pears.
// It is the one memorable element in the app, so it never leans on colour
// alone: every sticker carries the tier icon and the tier word as well, and it
// exposes itself to a screen reader as one plain sentence ("Brie: not now").

import { STRINGS } from './strings.js';
import { icon } from './icons.js';
import { prefersReducedMotion } from './util.js';

export const TIERS = Object.freeze({
  green: Object.freeze({ word: 'YES!', icon: 'circle-check', cls: 'go' }),
  yellow: Object.freeze({ word: 'LIMIT', icon: 'circle-alert', cls: 'easy' }),
  red: Object.freeze({ word: 'NOT NOW', icon: 'circle-x', cls: 'hold' }),
  depends: Object.freeze({ word: 'DEPENDS', icon: 'circle-alert', cls: 'depends' }),
});

const ICON_PX = 20;
const ICON_PX_MINI = 16;

// Build spec 6.2: the stamp is a 320ms animation on a 120ms delay, so it has
// landed by 440ms. The confetti follows 150ms after that.
const STAMP_MS = 440;
const CONFETTI_DELAY_MS = 150;
const CONFETTI_MS = 600;
const CONFETTI_GAP_MS = 10000;

const BIT_COUNT = 8;
const BIT_PX = 6;
const ARC_FROM_DEG = 240;
const ARC_TO_DEG = 300;
const BIT_MIN_PX = 36;
const BIT_SPREAD_PX = 36;
const BIT_SPIN_DEG = 120;

// The confetti colours are read straight off the token block so a theme change
// carries through, including in dark mode.
const BIT_COLOURS = ['var(--go-ink)', 'var(--butter)', 'var(--surface)'];

// Mirrors --ease-out in the token block. Inlined rather than read back from
// the stylesheet: the value is fixed by the spec and this runs mid-animation.
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';

let lastConfettiAt = 0;

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' ? node : fallback;
}

// The markup below is written with innerHTML, so anything that came from a
// data file or the strings file gets escaped on the way in.
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** An unrecognised tier falls back to DEPENDS: neutral never claims safety. */
function tierKey(tier) {
  const key = String(tier === null || tier === undefined ? '' : tier).toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(TIERS, key) ? key : 'depends';
}

function tierWord(key) {
  return str(`tiers.${key}.word`, str(`tierWords.${key}`, TIERS[key].word));
}

// VoiceOver reads the sticker as a sentence, and a shouted "NOT NOW" is not a
// sentence, so the spoken form is the quiet version of the same word.
function tierSpoken(key) {
  return str(`tiers.${key}.spoken`, tierWord(key).toLowerCase());
}

export function stickerHtml(tier, { mini = false, name = '' } = {}) {
  const key = tierKey(tier);
  const info = TIERS[key];
  const spoken = tierSpoken(key);
  const label = name ? `${name}: ${spoken}` : spoken;
  const cls = `sticker sticker--${info.cls}${mini ? ' sticker--mini' : ''}`;

  // role="img" plus a label, so the icon and the word read as one phrase
  // instead of as two loose fragments.
  return `<span class="${cls}" role="img" aria-label="${esc(label)}">`
    + icon(info.icon, { size: mini ? ICON_PX_MINI : ICON_PX })
    + `<span class="sticker__word">${esc(tierWord(key))}</span>`
    + '</span>';
}

/** The bits sit at the sticker's centre, which needs a positioned box. */
function ensurePositioned(node) {
  try {
    if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
  } catch {
    // No computed style available (no layout yet). The stylesheet's own
    // positioning is the normal path anyway.
  }
}

function confetti(host) {
  ensurePositioned(host);

  const layer = document.createElement('span');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '0',
    height: '0',
    overflow: 'visible',
    pointerEvents: 'none',
  });

  const step = (ARC_TO_DEG - ARC_FROM_DEG) / BIT_COUNT;

  for (let i = 0; i < BIT_COUNT; i += 1) {
    const bit = document.createElement('span');
    bit.className = 'confetti__bit';
    Object.assign(bit.style, {
      position: 'absolute',
      left: `${-BIT_PX / 2}px`,
      top: `${-BIT_PX / 2}px`,
      width: `${BIT_PX}px`,
      height: `${BIT_PX}px`,
      borderRadius: '50%',
      background: BIT_COLOURS[i % BIT_COLOURS.length],
      willChange: 'transform, opacity',
    });
    layer.appendChild(bit);

    // Degrees run clockwise from the x-axis in screen space, where y grows
    // downward, so 270 is straight up and 240 to 300 is the upward fan.
    const deg = ARC_FROM_DEG + (i + Math.random()) * step;
    const rad = (deg * Math.PI) / 180;
    const dist = BIT_MIN_PX + Math.random() * BIT_SPREAD_PX;
    const dx = Math.cos(rad) * dist;
    const dy = Math.sin(rad) * dist;
    const spin = Math.random() * BIT_SPIN_DEG * 2 - BIT_SPIN_DEG;

    if (typeof bit.animate === 'function') {
      bit.animate([
        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${spin.toFixed(0)}deg)`, opacity: 0 },
      ], { duration: CONFETTI_MS, easing: EASE_OUT, fill: 'forwards' });
    }
  }

  host.appendChild(layer);
  // One timer for the lot: the spec wants them gone from the DOM, and eight
  // finish handlers to do that is seven more than the job needs.
  setTimeout(() => layer.remove(), CONFETTI_MS + 80);
}

/**
 * Stamps the sticker on. GREEN gets confetti once the stamp has landed; LIMIT
 * and NOT NOW get nothing extra, because calm beats drama when the answer is no.
 */
export function playStamp(stickerEl, tier) {
  if (!stickerEl || !stickerEl.classList) return;

  // Re-searching the same food should still stamp, so the class is taken off
  // and the reflow read forces the browser to treat it as a fresh animation.
  stickerEl.classList.remove('reveal');
  void stickerEl.offsetWidth;
  stickerEl.classList.add('reveal');

  if (tierKey(tier) !== 'green') return;
  if (prefersReducedMotion()) return;
  if (Date.now() - lastConfettiAt < CONFETTI_GAP_MS) return;

  let fired = false;
  let timer = 0;

  const fire = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    stickerEl.removeEventListener('animationend', onStampEnd);
    if (!stickerEl.isConnected) return;
    // Re-checked at fire time: two stamps can be in flight at once, and only
    // the first of them gets to throw a party.
    if (Date.now() - lastConfettiAt < CONFETTI_GAP_MS) return;
    lastConfettiAt = Date.now();
    confetti(stickerEl);
  };

  // Guarded on target: an animation on the shine or the word bubbles up here
  // too, and that is not the stamp landing.
  const onStampEnd = (event) => {
    if (event.target !== stickerEl) return;
    setTimeout(fire, CONFETTI_DELAY_MS);
  };

  stickerEl.addEventListener('animationend', onStampEnd);
  // The timer is not only a safety net: if the stylesheet has not attached the
  // keyframes yet, animationend never comes and this is the only path.
  timer = setTimeout(fire, STAMP_MS + CONFETTI_DELAY_MS);
}
