// The menu scanner, both paths.
//
// Path B (the smart one) posts a resized photo to a Cloudflare Worker, which
// asks a vision model to classify each dish. Path A (basic reading) runs
// Tesseract.js on the phone and matches the text against data/lexicon.json.
// Both hand back the same dish shape so the Scan view renders them the same
// way, and both refuse to guess: anything unmatched lands in Unsure rather
// than being called safe.
//
// Nothing in here writes user-facing copy. Errors carry a `kind` and the view
// turns that into kind words from strings.js.

import { CONFIG } from './config.js';
import { STRINGS } from './strings.js';
import { getData } from './data.js';
import { normalise } from './util.js';

// Matches the Worker. A pub menu with starters, mains, sides and desserts runs
// past fifty, and a cap that bites is a cap that hides food from her.
const MAX_DISHES = 60;
const MAX_WHY = 160;
const MAX_NAME = 120;

// Ranked so "worst tier wins" is a number comparison. unsure sits outside the
// ranking on purpose: it is an admission, not a severity.
const TIER_RANK = Object.freeze({ green: 1, yellow: 2, red: 3 });
const TIERS = Object.freeze(['green', 'yellow', 'red', 'unsure']);

// Tesseract pulls its worker script, its wasm core and the English language
// data from the CDN on first use. Pinned so a surprise major version cannot
// change the API under the app.
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const OCR_LANG = 'eng';
const OCR_MODE = 1;          // LSTM only, which is the accurate engine in v5

const MIN_LINE_LETTERS = 3;
const PRICE_TAIL = /[\s.·•_-]*\$?\s*\d{1,3}(?:[.,]\d{1,2})?\s*$/;
const LIST_HEAD = /^[\s.·•*_+-]+/;

let tesseractPromise = null;
let matcher = null;

/* ------------------------------------------------------------------ helpers */

function str(path, fallback) {
  let node = STRINGS;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === 'string' && node.trim() ? node : fallback;
}

/**
 * Errors travel as a kind, never as a message. The view maps the kind to copy,
 * which is what keeps a raw stack trace off a screen she reads at 3am.
 * Kinds: offline, unreadable, daily-limit, timeout, cancelled, no-endpoint, failed.
 */
function scanError(kind, detail) {
  const err = new Error(detail || kind);
  err.kind = kind;
  return err;
}

function trim(value, max) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function tierOf(tier) {
  const key = String(tier === null || tier === undefined ? '' : tier).toLowerCase().trim();
  // An unknown tier is never promoted to safe. Unsure is the honest landing spot.
  return TIERS.includes(key) ? key : 'unsure';
}

function worstTier(a, b) {
  return (TIER_RANK[b] || 0) > (TIER_RANK[a] || 0) ? b : a;
}

function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Empty endpoint means the smart scanner does not exist yet, and we say so. */
export function hasSmartScanner() {
  const scanner = (CONFIG && CONFIG.scanner) || {};
  return Boolean(String(scanner.endpoint || '').trim());
}

/* ------------------------------------------------------------ dish shaping */

function shapeDish(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const dish = trim(entry.dish || entry.name || '', MAX_NAME);
  if (!dish) return null;
  return {
    dish,
    tier: tierOf(entry.tier),
    why: trim(entry.why || '', MAX_WHY),
    makeItGreen: trim(entry.makeItGreen || '', MAX_WHY),
  };
}

/**
 * Belt and braces on top of the Worker's own validation: an older Worker
 * deploy, or a hand-rolled response, still cannot flood the screen.
 */
function shapeDishes(dishes) {
  if (!Array.isArray(dishes)) return [];
  return dishes.map(shapeDish).filter(Boolean).slice(0, MAX_DISHES);
}

/** { red, yellow, green, unsure } in tier buckets, ready for the results view. */
export function groupDishes(dishes) {
  const groups = { red: [], yellow: [], green: [], unsure: [] };
  for (const entry of shapeDishes(dishes)) groups[entry.tier].push(entry);
  return groups;
}

/* --------------------------------------------------------------- image prep */

function decodeViaImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(scanError('unreadable', 'The photo could not be decoded.'));
    };
    img.src = url;
  });
}

/**
 * from-image matters: without it createImageBitmap ignores the EXIF rotation
 * a phone writes, and a sideways menu reads far worse. The img fallback
 * applies orientation on its own.
 */
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari rejects the options bag rather than ignoring it.
    }
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to the img decoder, which every browser has.
    }
  }
  return decodeViaImg(blob);
}

/**
 * Downscales by halving repeatedly before the final step, with smoothing set
 * to high the whole way.
 *
 * A phone photo is around 4000px and the upload is 1568px, and asking the
 * canvas for that in one jump samples so sparsely that thin strokes fall
 * between the samples. Menu descriptions are the first thing to go, which is
 * exactly where "poached", "house made" and "prosciutto" live. Halving keeps
 * every pixel contributing, so the small print survives the trip.
 *
 * The source rectangle arguments let a tile be cut straight out of the full
 * resolution photo, rather than out of an already shrunken copy.
 */
function drawResized(source, maxEdge, rect) {
  const fullW = source.width || source.naturalWidth || 0;
  const fullH = source.height || source.naturalHeight || 0;
  if (!fullW || !fullH) throw scanError('unreadable', 'The photo has no dimensions.');

  const sx = rect ? Math.max(0, Math.round(rect.x)) : 0;
  const sy = rect ? Math.max(0, Math.round(rect.y)) : 0;
  const sw = rect ? Math.min(fullW - sx, Math.round(rect.width)) : fullW;
  const sh = rect ? Math.min(fullH - sy, Math.round(rect.height)) : fullH;
  if (sw < 1 || sh < 1) throw scanError('unreadable', 'The crop is empty.');

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const targetW = Math.max(1, Math.round(sw * scale));
  const targetH = Math.max(1, Math.round(sh * scale));

  let canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  let context = canvas.getContext('2d');
  if (!context) throw scanError('failed', 'No 2d canvas context.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  let w = sw;
  let h = sh;
  while (w > targetW * 2) {
    w = Math.max(targetW, Math.round(w / 2));
    h = Math.max(targetH, Math.round(h / 2));
    const step = document.createElement('canvas');
    step.width = w;
    step.height = h;
    const stepContext = step.getContext('2d');
    if (!stepContext) break;
    stepContext.imageSmoothingEnabled = true;
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(canvas, 0, 0, w, h);
    canvas = step;
  }

  if (w !== targetW || h !== targetH) {
    const last = document.createElement('canvas');
    last.width = targetW;
    last.height = targetH;
    const lastContext = last.getContext('2d');
    if (lastContext) {
      lastContext.imageSmoothingEnabled = true;
      lastContext.imageSmoothingQuality = 'high';
      lastContext.drawImage(canvas, 0, 0, targetW, targetH);
      canvas = last;
    }
  }

  return canvas;
}

/**
 * A gentle levels stretch on the whole pixel, so paper goes white and ink goes
 * black without the hue shifting. Cafes are dim and warm, and a photo that
 * looks perfectly clear to her can sit in a narrow band of greys that costs
 * the model the small print.
 *
 * Half a percent is clipped off each end so one glare spot or one dark corner
 * cannot set the range, and a photo that is already contrasty is left alone.
 */
function autoLevels(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  let image;
  try {
    image = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return canvas;   // tainted canvas, so ship the photo as it is
  }

  const px = image.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    histogram[(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0] += 1;
  }

  const clip = (px.length / 4) * 0.005;
  let low = 0;
  let high = 255;
  for (let value = 0, seen = 0; value < 256; value += 1) {
    seen += histogram[value];
    if (seen > clip) { low = value; break; }
  }
  for (let value = 255, seen = 0; value >= 0; value -= 1) {
    seen += histogram[value];
    if (seen > clip) { high = value; break; }
  }

  // Already using most of the range, or so flat that stretching would only
  // amplify noise. Either way, leave it be.
  if (high - low < 40 || high - low > 235) return canvas;

  const scale = 255 / (high - low);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = Math.min(255, Math.max(0, (px[i] - low) * scale));
    px[i + 1] = Math.min(255, Math.max(0, (px[i + 1] - low) * scale));
    px[i + 2] = Math.min(255, Math.max(0, (px[i + 2] - low) * scale));
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Re-encoding through a canvas is the resize, and it is also a privacy win she
 * never has to think about: the new JPEG carries no EXIF, so the GPS fix, the
 * timestamp and the phone model in the original never leave the device.
 */
function toJpeg(canvas, quality) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw scanError('unreadable', 'The photo could not be re-encoded.');
  return dataUrl.slice(comma + 1);
}

/**
 * Builds what gets uploaded: the whole menu, plus overlapping halves when the
 * photo has detail to spare.
 *
 * One frame has to fit the model's window whatever the menu's size, so a big
 * menu arrives with its description lines shrunk into mush. Cutting the photo
 * in half and sending each half at full budget doubles the pixels on that
 * small print, and the halves overlap so a line sitting on the seam is still
 * whole somewhere. They travel as extra images on the same request, so a scan
 * is still one model call and still one tick against the daily limit.
 *
 * The whole frame goes first regardless: it is what keeps the layout, the
 * section headings and the prices tied together.
 */
async function encodeForUpload(blob) {
  const scanner = (CONFIG && CONFIG.scanner) || {};
  const maxEdge = Number(scanner.maxEdgePx) || 1568;
  const quality = Number(scanner.jpegQuality) || 0.9;
  const tilesOn = scanner.tiles !== false;

  const source = await decode(blob);
  const width = source.width || source.naturalWidth || 0;
  const height = source.height || source.naturalHeight || 0;

  const images = [toJpeg(autoLevels(drawResized(source, maxEdge)), quality)];

  // Only worth it when the full frame is being shrunk enough to lose strokes.
  // Below that the tiles would carry the same detail twice, for nothing.
  const longest = Math.max(width, height);
  if (tilesOn && longest >= maxEdge * 1.5) {
    const tall = height >= width;
    const span = tall ? height : width;
    const overlap = Math.round(span * 0.12);
    for (let index = 0; index < 2; index += 1) {
      const start = index === 0 ? 0 : Math.max(0, Math.round(span / 2) - overlap);
      const length = index === 0 ? Math.round(span / 2) + overlap : span - start;
      const rect = tall
        ? { x: 0, y: start, width, height: length }
        : { x: start, y: 0, width: length, height };
      try {
        images.push(toJpeg(autoLevels(drawResized(source, maxEdge, rect)), quality));
      } catch {
        // A tile is an optimisation. Losing one is not worth losing the scan.
      }
    }
  }

  if (typeof source.close === 'function') source.close();
  return images;
}

/**
 * Greyscale plus a contrast stretch, for OCR only. Tesseract reads flat printed
 * text much better than it reads a warm cafe photo, and this costs one pass.
 */
function sharpenForOcr(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  let image;
  try {
    image = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return canvas;   // no pixel access, so ship the photo as it is
  }

  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    // Centred on mid grey so paper goes white and ink goes black.
    const boosted = Math.min(255, Math.max(0, (grey - 128) * 1.45 + 128));
    px[i] = boosted;
    px[i + 1] = boosted;
    px[i + 2] = boosted;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ Path B */

/**
 * Wraps the caller's signal and the config timeout into one controller, and
 * remembers which of the two fired so a cancel is never reported as a failure.
 */
function linkAbort(signal, timeoutMs) {
  const controller = new AbortController();
  let reason = 'failed';

  const timer = setTimeout(() => {
    reason = 'timeout';
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    reason = 'cancelled';
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }

  return {
    signal: controller.signal,
    reason: () => reason,
    release() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

async function readError(res) {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // A proxy or a cold Worker can answer with HTML. Status alone will do.
  }
  return '';
}

/** Path B: the smart scanner. Resolves to { mode: 'smart', dishes }. */
export async function scanWithWorker(blob, { signal } = {}) {
  const scanner = (CONFIG && CONFIG.scanner) || {};
  if (!hasSmartScanner()) throw scanError('no-endpoint', 'CONFIG.scanner.endpoint is empty.');
  if (offline()) throw scanError('offline', 'The device reports no network.');

  const images = await encodeForUpload(blob);
  const link = linkAbort(signal, Number(scanner.timeoutMs) || 45000);

  try {
    const res = await fetch(String(scanner.endpoint).trim(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bump-pass': String(scanner.pass || ''),
      },
      // `image` carries the whole frame and `images` carries the tiles too.
      // Sending both means a Worker deployed before the tiles existed still
      // gets exactly what it used to, so the two can be rolled out in any order.
      body: JSON.stringify({ image: images[0], images }),
      signal: link.signal,
    });

    if (res.status === 429) throw scanError('daily-limit', 'Worker daily quota spent.');
    if (!res.ok) {
      const kind = await readError(res);
      throw scanError(kind === 'unreadable' || kind === 'bad-image' ? 'unreadable' : 'failed', `HTTP ${res.status}`);
    }

    let body;
    try {
      body = await res.json();
    } catch {
      throw scanError('unreadable', 'The Worker did not return JSON.');
    }

    if (body && typeof body.error === 'string') {
      throw scanError(body.error === 'daily-limit' ? 'daily-limit' : 'unreadable', body.error);
    }

    const dishes = shapeDishes(body && body.dishes);
    // An empty menu is not a result, it is a photo that did not work.
    if (!dishes.length) throw scanError('unreadable', 'No dishes came back.');
    // A menu too long for one answer comes back cut short. She is told, because
    // a list that looks complete and is not is the one result worth refusing.
    return { mode: 'smart', dishes, partial: Boolean(body && body.partial) };
  } catch (cause) {
    // Anything already carrying a kind is a verdict reached on purpose above.
    if (cause && cause.kind) throw cause;
    const reason = link.reason();
    if (reason === 'cancelled') throw scanError('cancelled', 'She tapped cancel.');
    if (reason === 'timeout') throw scanError('timeout', 'The scanner did not answer in time.');
    // A fetch that rejects without an abort is a dead network or a dead
    // Worker, and from the queue at a cafe those feel like the same thing.
    throw scanError(offline() ? 'offline' : 'failed', String(cause && cause.message));
  } finally {
    // Released only once the body has been read, not when the headers land.
    // Releasing early cleared the timer and dropped the abort listener while
    // res.json() was still waiting, so a connection that died mid-body left
    // the spinner turning forever with Cancel no longer able to stop it.
    link.release();
  }
}

/* ------------------------------------------------------------------ Path A */

/**
 * Honest about the limitation: Tesseract cannot load from a CDN with no
 * network, so basic reading is only offline-capable once the browser has
 * cached the worker, the wasm core and the language data. A failed load is
 * reported as the offline error rather than left to hang.
 */
async function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  if (offline()) throw scanError('offline', 'Basic reading needs the network for its first load.');

  tesseractPromise = import(TESSERACT_URL)
    .then((mod) => {
      const create = (mod && mod.createWorker) || (mod && mod.default && mod.default.createWorker);
      if (typeof create !== 'function') throw scanError('failed', 'Tesseract loaded without createWorker.');
      return create;
    })
    .catch((cause) => {
      tesseractPromise = null;   // so a later attempt with signal can retry
      if (cause && cause.kind) throw cause;
      throw scanError('offline', String(cause && cause.message));
    });

  return tesseractPromise;
}

async function ocrText(blob, onProgress) {
  const createWorker = await loadTesseract();
  const scanner = (CONFIG && CONFIG.scanner) || {};
  const maxEdge = Number(scanner.maxEdgePx) || 1280;
  const canvas = sharpenForOcr(drawResized(await decode(blob), maxEdge));

  const report = (value) => {
    if (typeof onProgress === 'function') onProgress(Math.min(1, Math.max(0, value)));
  };

  let worker = null;
  try {
    worker = await createWorker(OCR_LANG, OCR_MODE, {
      // Paths are left at their defaults so the worker, core and language data
      // all come from the same pinned version on the CDN.
      logger: (message) => {
        if (message && message.status === 'recognizing text' && typeof message.progress === 'number') {
          report(message.progress);
        }
      },
    });
    const out = await worker.recognize(canvas);
    report(1);
    return (out && out.data && out.data.text) || '';
  } catch (cause) {
    if (cause && cause.kind) throw cause;
    throw scanError(offline() ? 'offline' : 'failed', String(cause && cause.message));
  } finally {
    if (worker && typeof worker.terminate === 'function') {
      // Frees the wasm heap. Left running it costs tens of megabytes on a
      // phone that is also holding a camera roll open.
      try {
        await worker.terminate();
      } catch {
        // Nothing useful to do about a worker that will not shut down.
      }
    }
  }
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Phrases are normalised the same way the OCR text is, so "béarnaise" and
 * "pâté" match after folding, and sorted longest first so "smoked salmon"
 * always beats "salmon" and multi-word terms are tried before single words.
 */
function buildMatcher() {
  const bundle = getData();
  const phrases = [];

  for (const term of bundle.lexicon || []) {
    if (!term || !Array.isArray(term.match)) continue;
    const tier = tierOf(term.tier);
    for (const raw of term.match) {
      const phrase = normalise(raw);
      if (!phrase) continue;
      phrases.push({
        phrase,
        words: phrase.split(' ').length,
        test: new RegExp(`\\b${escapeRe(phrase)}\\b`),
        all: new RegExp(`\\b${escapeRe(phrase)}\\b`, 'g'),
        tier,
        why: trim(term.why || '', MAX_WHY),
        makeItGreen: trim(term.makeItGreen || '', MAX_WHY),
      });
    }
  }

  phrases.sort((a, b) => b.words - a.words || b.phrase.length - a.phrase.length);

  const cooked = (bundle.cookedSignals || [])
    .map((raw) => normalise(raw))
    .filter(Boolean)
    .map((phrase) => new RegExp(`\\b${escapeRe(phrase)}\\b`));

  return { phrases, cooked };
}

function getMatcher() {
  if (!matcher) matcher = buildMatcher();
  return matcher;
}

function cleanLine(raw) {
  const text = String(raw).replace(/\s+/g, ' ').replace(LIST_HEAD, '').trim();
  if (!text) return '';
  const priced = text.replace(PRICE_TAIL, '').trim();
  // Only drop the trailing price when a real dish name survives it.
  const kept = (priced.match(/[a-z]/gi) || []).length >= MIN_LINE_LETTERS ? priced : text;
  return trim(kept, MAX_NAME);
}

function menuLines(text) {
  const seen = new Set();
  const lines = [];

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    if ((line.match(/[a-z]/gi) || []).length < MIN_LINE_LETTERS) continue;
    const key = normalise(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= MAX_DISHES) break;
  }

  return lines;
}

function readLine(line) {
  const { phrases, cooked } = getMatcher();
  const folded = normalise(line);
  let rest = folded;
  let tier = '';
  let hit = null;

  for (const entry of phrases) {
    if (!entry.test.test(rest)) continue;
    // The matched span is consumed so a shorter phrase inside it cannot claim
    // the same words twice.
    rest = rest.replace(entry.all, ' ');
    const next = tier ? worstTier(tier, entry.tier) : entry.tier;
    if (next !== tier) {
      tier = next;
      hit = entry;   // the first phrase to reach this tier is the longest one
    }
  }

  const cookedSignal = cooked.some((re) => re.test(folded));

  if (hit) {
    // A cooked signal raises confidence and never overrides a red term: a hot
    // grilled dish is still a hot grilled dish with hollandaise on it.
    return {
      dish: line,
      tier,
      why: hit.why,
      makeItGreen: hit.makeItGreen,
    };
  }

  if (cookedSignal) {
    return {
      dish: line,
      tier: 'green',
      why: str('scanning.cookedWhy', 'Cooked through and served hot is the safe way, and nothing on my risk list showed up here.'),
      makeItGreen: '',
    };
  }

  return {
    dish: line,
    tier: 'unsure',
    why: str('scanning.unsureWhy', 'Nothing on my list turned up in this line, so it is worth an ask.'),
    makeItGreen: '',
  };
}

/** Path A: basic on-device reading. Resolves to { mode: 'basic', dishes }. */
export async function scanWithOcr(blob, { onProgress } = {}) {
  const text = await ocrText(blob, onProgress);
  const lines = menuLines(text);
  if (!lines.length) throw scanError('unreadable', 'The OCR pass found no readable lines.');

  let dishes;
  try {
    dishes = lines.map(readLine);
  } catch (cause) {
    // getData throws before loadData has finished, which would mean no lexicon.
    throw scanError('failed', String(cause && cause.message));
  }

  return { mode: 'basic', dishes: shapeDishes(dishes) };
}
