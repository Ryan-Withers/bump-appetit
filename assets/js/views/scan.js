// The Scan screen: a five-state machine, idle -> preview -> scanning ->
// results | error, per build spec 5.4.
//
// Two engines sit behind it. The smart scanner (Path B) sends a resized photo
// to the Worker. Basic reading (Path A) runs on the phone. The view never
// shows a raw error: every failure is a kind, and every kind has kind words.

import { STRINGS } from '../strings.js';
import { $, el, prefersReducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { stickerHtml } from '../sticker.js';
import { scanWithWorker, scanWithOcr, groupDishes, hasSmartScanner } from '../scanner.js';

const VIEW_ID = 'scan';

const ROTATE_MS = 2500;      // build spec 5.4: the scanning copy rotates on 2.5s
const CAMERA_PX = 32;        // icon inside the 72px circular button

// HOLD first: she needs the warnings before the good news. Unsure sits last
// because it is the group that ends in a question for the staff.
const TIER_ORDER = Object.freeze(['red', 'yellow', 'green', 'unsure']);

const GROUP_FALLBACKS = Object.freeze({
  red: 'Not now',
  yellow: 'Limit',
  green: 'Yes',
  unsure: 'Unsure',
});

const SCANNING_FALLBACKS = Object.freeze([
  'Reading the menu so you don\'t have to squint...',
  'Checking the fine print for sneaky hollandaise...',
  'Consulting the fridge rules...',
  'Nearly there, hold your appetite...',
]);

const ASK_FALLBACKS = Object.freeze([
  'Is the mayo from a jar?',
  'Can that be cooked through?',
  'Was the sushi made fresh today?',
  'Is the fish of the day flake?',
]);

// Every error kind she can reach, with its own icon and its own copy. An
// unknown kind lands on 'failed', which is honest without being alarming.
const ERRORS = Object.freeze({
  offline: Object.freeze({
    icon: 'wifi-off',
    path: 'scanning.errors.offline',
    title: 'Scanner needs internet',
    body: 'Search still works! Bites, cheat sheets and the trackers all work offline too.',
  }),
  unreadable: Object.freeze({
    icon: 'image',
    path: 'scanning.errors.unreadable',
    title: 'Couldn\'t read that one',
    body: 'Try flattening the menu and getting closer. Good light helps more than a steady hand.',
  }),
  'daily-limit': Object.freeze({
    icon: 'circle-alert',
    path: 'scanning.errors.dailyLimit',
    title: 'That\'s today\'s scans used up',
    body: 'The scanner has a daily cap so it stays free to run. It resets tomorrow, and search has every food in the cookbook in the meantime.',
  }),
  timeout: Object.freeze({
    icon: 'refresh-cw',
    path: 'scanning.errors.timeout',
    title: 'That one took too long',
    body: 'The connection dropped out somewhere. Have another go, or search the dish by name.',
  }),
  failed: Object.freeze({
    icon: 'refresh-cw',
    path: 'scanning.errors.generic',
    title: 'The scanner tripped on that one',
    body: 'Nothing lost. Try another photo, or search the dish by name.',
  }),
});

/* ----------------------------------------------------------------- strings */

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

/** An unsure dish wears the neutral DEPENDS sticker: it is a question, not a no. */
function stickerTier(tier) {
  return tier === 'unsure' ? 'depends' : tier;
}

export function createScanView(ctx = {}) {
  // Config is read inside scanner.js, which is the one place that knows what
  // an endpoint means, so this view only ever asks it the yes-or-no question.
  const S = ctx.strings || STRINGS || {};

  const str = (paths, fallback) => {
    const value = readPath(S, paths, null);
    return typeof value === 'string' ? value : fallback;
  };

  const strList = (paths, fallback) => {
    const value = readPath(S, paths, null);
    if (!Array.isArray(value)) return fallback;
    const kept = value.filter((entry) => typeof entry === 'string' && entry.trim());
    return kept.length ? kept : fallback;
  };

  /* ------------------------------------------------------------------ shell */

  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) {
    inner = el('div', { class: 'view__inner' });
    root.appendChild(inner);
  }
  inner.replaceChildren();

  const live = el('p', { class: 'sr-only', role: 'status', aria: { live: 'polite', atomic: 'true' } });
  const stage = el('div', { class: 'stack' });

  // The guide-not-a-guarantee line is permanent, so it is part of the shell
  // rather than something each state has to remember to render.
  const disclaimer = el('p', {
    class: 'disclaimer',
    text: str(
      'scanning.guide',
      'Scanner\'s a guide, not a guarantee. When unsure, ask the staff or search the food above.'
    ),
  });

  /**
   * Clipped rather than display:none, because a file input that is not
   * rendered cannot always be opened by a programmatic click on iOS.
   */
  function fileInput(useCamera) {
    const node = el('input', {
      type: 'file',
      accept: 'image/*',
      // capture points straight at the rear camera. It is also why there is a
      // second input without it: on iOS, capture removes the Photos option,
      // and the spec wants her able to shoot OR pick.
      capture: useCamera ? 'environment' : false,
      tabindex: '-1',
      aria: { hidden: 'true' },
      style: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      },
    });
    node.addEventListener('change', () => {
      const file = node.files && node.files[0];
      // Cleared straight away so picking the very same photo twice still fires.
      node.value = '';
      if (file) setPhoto(file);
    });
    return node;
  }

  const cameraInput = fileInput(true);
  const libraryInput = fileInput(false);

  inner.append(live, stage, disclaimer, cameraInput, libraryInput);

  /* ------------------------------------------------------------------ state */

  let state = 'idle';
  let photo = null;          // { file, url }
  let errorKind = 'failed';
  let result = null;         // { mode, groups, count, partial }
  let mode = hasSmartScanner() ? 'smart' : 'basic';
  let controller = null;
  let runId = 0;
  let rotateTimer = 0;
  let rotateAt = 0;
  let progress = -1;
  let statusEl = null;

  function releasePhoto() {
    if (photo && photo.url) URL.revokeObjectURL(photo.url);
    photo = null;
  }

  function setPhoto(file) {
    releasePhoto();
    photo = { file, url: URL.createObjectURL(file) };
    state = 'preview';
    render();
  }

  function retake() {
    cancelRun();
    releasePhoto();
    result = null;
    progress = -1;
    mode = hasSmartScanner() ? 'smart' : 'basic';
    state = 'idle';
    render();
  }

  /* ---------------------------------------------------------------- running */

  function stopRotator() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = 0;
    }
  }

  function statusText() {
    // Reduced motion swaps the sweeping band for one still caption. The
    // authored line is static, so no percentage is spliced in.
    if (prefersReducedMotion()) {
      return str('scanning.progressStatic', 'Reading the menu...');
    }
    const lines = strList('scanning.lines', SCANNING_FALLBACKS);
    return lines[rotateAt % lines.length];
  }

  function paintStatus() {
    if (statusEl) statusEl.textContent = statusText();
  }

  function startRotator() {
    stopRotator();
    // Under reduced motion the sweeping band is replaced by one still caption,
    // so there is nothing to rotate.
    if (prefersReducedMotion()) return;
    rotateTimer = setInterval(() => {
      rotateAt += 1;
      paintStatus();
    }, ROTATE_MS);
  }

  function onProgress(value) {
    progress = value;
    paintStatus();
  }

  function cancelRun() {
    runId += 1;
    stopRotator();
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  async function run(useBasic) {
    if (!photo) return;

    runId += 1;
    const id = runId;
    mode = useBasic ? 'basic' : 'smart';
    progress = -1;
    rotateAt = 0;
    controller = useBasic ? null : new AbortController();

    state = 'scanning';
    render();

    try {
      const out = useBasic
        ? await scanWithOcr(photo.file, { onProgress })
        // Basic reading has no abort hook, so a cancel there is handled by the
        // run id: the answer simply never reaches the screen.
        : await scanWithWorker(photo.file, { signal: controller.signal });

      if (id !== runId) return;
      result = {
        mode: out.mode || mode,
        groups: groupDishes(out.dishes),
        count: out.dishes.length,
        partial: Boolean(out.partial),
      };
      state = 'results';
    } catch (err) {
      if (id !== runId) return;
      const kind = (err && err.kind) || 'failed';
      if (kind === 'cancelled') {
        state = 'preview';
        render();
        return;
      }
      errorKind = ERRORS[kind] ? kind : 'failed';
      state = 'error';
    } finally {
      if (id === runId) {
        controller = null;
        stopRotator();
      }
    }

    if (id === runId) render();
  }

  /* ------------------------------------------------------------------ parts */

  function photoFrame(withLine) {
    // Position and clipping are set inline as well as in the stylesheet: the
    // band has to be pinned inside the photo no matter which lands first.
    const frame = el('div', {
      class: 'scan card',
      style: { position: 'relative', overflow: 'hidden' },
    }, [
      el('img', {
        class: 'scan__preview',
        src: photo.url,
        alt: str('a11y.scanPreview', 'The menu photo you are about to check'),
        // A phone photo is 4000px wide. The cap is inline so a slow stylesheet
        // can never let one blow the layout out sideways.
        style: { maxWidth: '100%' },
      }),
    ]);

    if (withLine && !prefersReducedMotion()) {
      // Geometry belongs to the stylesheet: .scan__line is a full-height
      // overlay carrying the 56px gradient band as a background, and the
      // sweep animation translates the whole overlay down the photo. An
      // inline height here once pinned it to the top 56px of the frame.
      frame.appendChild(el('div', { class: 'scan__line', aria: { hidden: 'true' } }));
    }

    return frame;
  }

  function button(label, { primary = false, onClick, iconName = '' } = {}) {
    return el('button', {
      class: primary ? 'btn btn--primary' : 'btn btn--ghost',
      type: 'button',
      on: { click: onClick },
    }, [
      iconName ? el('span', { aria: { hidden: 'true' }, html: icon(iconName, { size: 20 }) }) : null,
      label,
    ]);
  }

  function calloutEl(message) {
    return el('div', { class: 'callout callout--green' }, [
      el('span', { aria: { hidden: 'true' }, html: icon('sparkles', { size: 20, cls: 'callout__icon' }) }),
      el('p', {}, message),
    ]);
  }

  function tipsBlock() {
    const tip = el('p', {
      class: 'caption',
      hidden: true,
      style: { display: 'none' },
      text: str('scanning.tips', 'Best shots: flat menu, good light, fill the frame'),
    });

    const toggle = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      aria: { expanded: 'false' },
      text: str('scan.tipsLabel', 'Tips for a good shot'),
    });

    toggle.addEventListener('click', () => {
      const on = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!on));
      tip.hidden = on;
      // The inline display settles it against any class rule that would keep a
      // "collapsed" tip on screen.
      tip.style.display = on ? 'none' : '';
    });

    return el('div', { class: 'stack' }, [toggle, tip]);
  }

  /* ------------------------------------------------------------------ states */

  function idleContent() {
    const smart = hasSmartScanner();

    const shoot = el('button', {
      class: 'scan__button',
      type: 'button',
      aria: { label: str('ui.buttons.snapMenu', 'Snap the menu') },
      html: icon('camera', { size: CAMERA_PX }),
    });
    shoot.addEventListener('click', () => cameraInput.click());

    return el('div', { class: 'stack' }, [
      el('h1', { class: 'greeting', text: str('scanning.idleTitle', 'Snap the menu') }),
      el('p', {
        class: 'caption',
        text: str('scanning.idleCaption', 'Point at any menu. I\'ll sort it into Yes, Limit and Not now.'),
      }),
      shoot,
      button(str('scan.choose', 'Choose from Photos'), { onClick: () => libraryInput.click(), iconName: 'image' }),
      tipsBlock(),
      el('p', {
        class: 'caption',
        text: smart
          ? str('scanning.privacy', 'Your photo is sent away to be read, and it is not kept afterwards. Menus only, and nothing else on your phone is touched.')
          : str(
            'scanning.noEndpointBody',
            'Basic on-device reading is available instead. It never sends your photo anywhere, and it reads plain menu fonts best.'
          ),
      }),
    ]);
  }

  function previewContent() {
    const smart = hasSmartScanner();
    return el('div', { class: 'stack' }, [
      photoFrame(false),
      button(
        smart ? str('ui.buttons.checkMenu', 'Check this menu') : str('ui.buttons.readOnDevice', 'Read it on this phone instead'),
        { primary: true, onClick: () => run(!smart) }
      ),
      button(str('ui.buttons.retake', 'Retake'), { onClick: retake }),
    ]);
  }

  function scanningContent() {
    statusEl = el('p', {
      class: 'scan__status',
      // The rotating line is decoration for the wait. Announcing it every 2.5
      // seconds would talk over her, so the live region says it once instead.
      aria: { hidden: 'true' },
      text: statusText(),
    });

    return el('div', { class: 'stack' }, [
      photoFrame(true),
      statusEl,
      button(str('ui.buttons.cancel', 'Cancel'), {
        onClick: () => {
          cancelRun();
          state = 'preview';
          render();
        },
      }),
    ]);
  }

  function asksBlock() {
    const asks = strList('scanning.asks', ASK_FALLBACKS);
    return el('div', { class: 'stack' }, [
      el('h3', { class: 'caption', text: str('scanning.asksTitle', 'Magic questions for the staff') }),
      el('ul', { class: 'asks' }, asks.map((ask) => el('li', {}, ask))),
    ]);
  }

  function dishRow(entry) {
    const row = el('div', { class: 'dish' }, [
      el('p', { class: 'dish__name', text: entry.dish }),
    ]);
    // Colour, icon and word together, same as every other verdict in the app.
    row.insertAdjacentHTML('beforeend', stickerHtml(stickerTier(entry.tier), { mini: true }));
    if (entry.why) row.appendChild(el('p', { class: 'dish__why', text: entry.why }));
    if (entry.makeItGreen) row.appendChild(calloutEl(entry.makeItGreen));
    return row;
  }

  function groupTitle(tier, count) {
    const word = str(`scanning.groups.${tier}`, GROUP_FALLBACKS[tier]);
    return fill(str('scan.groupCount', '{title} ({n})'), { title: word, n: count });
  }

  function resultsContent() {
    const host = el('div', { class: 'stack' });

    if (result.mode === 'basic') {
      host.appendChild(el('p', {
        class: 'caption',
        text: str('scan.basicCaption', 'Basic mode: caught keywords only, so double-check.'),
      }));
    }

    for (const tier of TIER_ORDER) {
      const dishes = result.groups[tier] || [];
      if (!dishes.length) continue;
      host.appendChild(el('h2', { class: 'group-title', text: groupTitle(tier, dishes.length) }));
      for (const entry of dishes) host.appendChild(dishRow(entry));
      // The unsure group is the one that ends in a question, so the questions
      // live with it rather than at the bottom of the screen.
      if (tier === 'unsure') host.appendChild(asksBlock());
    }

    host.appendChild(button(str('ui.buttons.tryAgain', 'Try again'), { primary: true, onClick: retake }));
    return host;
  }

  function errorContent() {
    const spec = ERRORS[errorKind] || ERRORS.failed;
    const host = el('div', { class: 'empty' }, [
      el('span', { aria: { hidden: 'true' }, html: icon(spec.icon, { size: 32 }) }),
      el('p', { class: 'empty__title', text: str(`${spec.path}.title`, spec.title) }),
      el('p', { text: str(`${spec.path}.body`, spec.body) }),
    ]);

    const actions = el('div', { class: 'stack' });
    actions.appendChild(button(str('ui.buttons.retake', 'Retake'), { primary: true, onClick: retake }));

    // A menu longer than one answer comes back cut short. Saying so is the
    // whole point: she can scroll a short list happily, as long as she knows to
    // search the dishes that are missing from it.
    if (result && result.partial) {
      actions.appendChild(el('p', {
        class: 'caption',
        text: str(
          'scan.partialNote',
          'That is a big menu, so this is as far as the read got. Search anything you cannot see here.'
        ),
      }));
    }

    // Basic reading is worth offering after any smart-scanner failure, but only
    // with the truth attached: its reader downloads once, so it needs a little
    // network the first time too.
    if (mode !== 'basic' && photo) {
      actions.appendChild(button(str('ui.buttons.readOnDevice', 'Read it on this phone instead'), {
        onClick: () => run(true),
      }));
      actions.appendChild(el('p', {
        class: 'caption',
        text: str(
          'scan.basicNote',
          'Basic reading happens on your phone and catches keywords only. It downloads its reader the first time, so it needs a little internet too.'
        ),
      }));
    }

    host.appendChild(actions);
    return host;
  }

  /* ----------------------------------------------------------------- render */

  function announce() {
    if (state === 'scanning') {
      live.textContent = str('scanning.progressStatic', 'Reading the menu...');
      return;
    }
    if (state === 'results' && result) {
      live.textContent = fill(str('scan.found', '{n} dishes read'), { n: result.count });
      return;
    }
    if (state === 'error') {
      const spec = ERRORS[errorKind] || ERRORS.failed;
      live.textContent = str(`${spec.path}.title`, spec.title);
      return;
    }
    live.textContent = '';
  }

  function render() {
    statusEl = null;

    if (state === 'preview' && photo) stage.replaceChildren(previewContent());
    else if (state === 'scanning' && photo) stage.replaceChildren(scanningContent());
    else if (state === 'results' && result) stage.replaceChildren(resultsContent());
    else if (state === 'error') stage.replaceChildren(errorContent());
    else {
      state = 'idle';
      stage.replaceChildren(idleContent());
    }

    if (state === 'scanning') startRotator();
    else stopRotator();

    announce();
  }

  render();

  return {
    id: VIEW_ID,
    el: root,

    onEnter() {
      // A scan that was running when she wandered off is still running, so the
      // rotator picks up where it left off rather than freezing mid-wait.
      if (state === 'scanning') startRotator();
    },

    onLeave() {
      stopRotator();
    },
  };
}
