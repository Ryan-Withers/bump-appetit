// Small shared helpers. No imports, no side effects on load, so every other
// module can pull from here without worrying about ordering.

const FILLER = new Set([
  'can', 'i', 'eat', 'have', 'is', 'are', 'it', 'safe', 'ok', 'okay', 'to',
  'the', 'a', 'while', 'when', 'pregnant', 'during', 'pregnancy',
]);

const STORE_PREFIX = 'ba:';

// Session mirror of everything we have written. iOS private mode and quota
// errors make localStorage throw, so the app degrades to in-memory rather
// than losing the interaction. Nothing critical may live only in storage.
const memory = new Map();

const rafPending = new WeakMap();

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function appendChildren(node, children) {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(node, child);
    return;
  }
  if (children instanceof Node) {
    node.appendChild(children);
    return;
  }
  node.appendChild(document.createTextNode(String(children)));
}

/**
 * Tiny hyperscript.
 * el('div', { class: 'x', text: 'hi', html: '<b>b</b>', aria: { label: 'x' },
 *             data: { id: '1' }, on: { click: fn } }, [childNodes])
 * children may be a string, a Node, or a (nested) array of either.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'aria' && typeof value === 'object') {
      // false is meaningful here: aria-pressed="false" is how a toggle says
      // "off", unlike an HTML boolean attribute which is simply absent.
      for (const [name, val] of Object.entries(value)) {
        if (val !== null && val !== undefined) node.setAttribute(`aria-${name}`, String(val));
      }
    } else if (key === 'data' && typeof value === 'object') {
      for (const [name, val] of Object.entries(value)) {
        if (val !== null && val !== undefined) node.dataset[name] = String(val);
      }
    } else if (key === 'on' && typeof value === 'object') {
      for (const [type, handler] of Object.entries(value)) {
        if (handler) node.addEventListener(type, handler);
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

/**
 * Search-grade text folding, applied to both the query and the index so
 * "Can I eat pate?" and "pâté" land on comparable text.
 */
export function normalise(str) {
  return String(str === null || str === undefined ? '' : str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Apostrophes close up so "women's" folds to "womens", everything else
    // becomes a space, which collapses runs of punctuation in one pass.
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Peels question words off both ends: "is brie safe" and "brie while pregnant"
 * both reduce to "brie". Never returns nothing, because an empty query would
 * turn a real question into a no-results screen.
 */
export function stripFiller(str) {
  const base = normalise(str);
  if (!base) return base;

  const words = base.split(' ');
  let start = 0;
  let end = words.length;

  while (start < end && FILLER.has(words[start])) start += 1;
  while (end > start && FILLER.has(words[end - 1])) end -= 1;

  const kept = words.slice(start, end);
  return kept.length ? kept.join(' ') : base;
}

/** FNV-1a, 32-bit, always non-negative, so a food id always picks the same opener. */
export function hashString(str) {
  const s = String(str === null || str === undefined ? '' : str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick(arr, seed) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr[hashString(seed) % arr.length];
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD in local time, so the caffeine day rolls over at her midnight. */
export function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const store = {
  get(key, fallback = null) {
    const full = STORE_PREFIX + key;
    // Memory wins: if a write was rejected for quota, it holds the newer value.
    if (memory.has(full)) return memory.get(full);
    try {
      const raw = window.localStorage.getItem(full);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    const full = STORE_PREFIX + key;
    memory.set(full, value);
    try {
      window.localStorage.setItem(full, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  del(key) {
    const full = STORE_PREFIX + key;
    memory.delete(full);
    try {
      window.localStorage.removeItem(full);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Queues fn for the next frame, at most once per frame per function, so a
 * burst of input or scroll events collapses into a single paint-aligned run.
 * Returns a cancel function.
 */
export function onceRaf(fn) {
  if (typeof fn !== 'function') return () => {};

  const cancel = () => {
    const id = rafPending.get(fn);
    if (id !== undefined) {
      rafPending.delete(fn);
      cancelAnimationFrame(id);
    }
  };

  if (rafPending.has(fn)) return cancel;

  const id = requestAnimationFrame((t) => {
    rafPending.delete(fn);
    fn(t);
  });
  rafPending.set(fn, id);
  return cancel;
}

export function clamp(n, min, max) {
  const num = Number(n);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}
