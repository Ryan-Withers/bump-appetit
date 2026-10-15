// This week. The tab that answers "what am I meant to be doing right now".
//
// Everything here comes off one date. The week number picks an entry out of
// weeks.json, the day number picks the stage band, and both get projected onto
// real calendar dates so "week 6" also reads as "19 to 25 May".

import { STRINGS } from '../strings.js';
import { $, el } from '../util.js';
import { icon } from '../icons.js';
import { getData } from '../data.js';
import * as sync from '../sync.js';
import {
  currentPosition, entryForWeek, datesForWeek, shortDate, ageLabel, hasArrived,
} from '../timeline.js';

const VIEW_ID = 'week';

function readPath(source, path, fallback) {
  let node = source;
  for (const key of String(path).split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) return fallback;
    node = node[key];
  }
  return node === null || node === undefined || node === '' ? fallback : node;
}

export function createWeekView(ctx = {}) {
  const S = ctx.strings || STRINGS;
  const str = (path, fallback) => {
    const value = readPath(S, path, null);
    return typeof value === 'string' ? value : fallback;
  };

  const root = $(`#view-${VIEW_ID}`) || el('section', { class: 'view', id: `view-${VIEW_ID}` });
  let inner = $('.view__inner', root);
  if (!inner) { inner = el('div', { class: 'view__inner' }); root.appendChild(inner); }

  function stageFor(day) {
    const stages = getData().stages || [];
    return stages.find((s) => day >= s.fromDay && day <= s.toDay) || (day < 0 ? stages[0] : stages[stages.length - 1]);
  }

  /** A checklist tick is shared state, so it goes through sync rather than straight to storage. */
  function tickRow(key, label, detail, howtoId) {
    const on = Boolean(sync.get(key, false));
    const box = el('span', { class: 'ingredient__box', aria: { hidden: 'true' } },
      on ? icon('circle-check', { size: 22 }) : '');
    const row = el('button', {
      class: `ingredient${on ? ' is-done' : ''}`,
      type: 'button',
      aria: { pressed: String(on) },
    }, [
      box,
      el('span', { class: 'ingredient__text' }, [
        el('span', { class: 'ingredient__label' }, label),
        detail ? el('span', { class: 'ingredient__detail' }, detail) : null,
      ].filter(Boolean)),
      howtoId ? el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 18 }) }) : null,
    ].filter(Boolean));

    row.addEventListener('click', (event) => {
      // Tapping the chevron opens the how-to; tapping anywhere else ticks it.
      if (howtoId && event.target.closest('.row__chev')) {
        if (typeof ctx.openHowto === 'function') ctx.openHowto(howtoId);
        return;
      }
      const next = !Boolean(sync.get(key, false));
      sync.set(key, next);
      row.classList.toggle('is-done', next);
      row.setAttribute('aria-pressed', String(next));
      box.innerHTML = next ? icon('circle-check', { size: 22 }) : '';
    });
    return row;
  }

  function expectEl(expect) {
    if (!expect) return null;
    const rows = [
      ['expectFeeds', 'Feeds', expect.feeds],
      ['expectSleep', 'Sleep', expect.sleep],
      ['expectTummy', 'Tummy time', expect.tummyTime],
      ['expectNappies', 'Nappies', expect.nappies],
    ].filter(([, , value]) => value);
    if (!rows.length) return null;

    const grid = el('div', { class: 'expect' });
    for (const [key, fallback, value] of rows) {
      grid.appendChild(el('div', { class: 'expect__row' }, [
        el('span', { class: 'expect__label' }, str(`week.${key}`, fallback)),
        el('span', { class: 'expect__value' }, value),
      ]));
    }
    return el('section', { class: 'card' }, [
      el('h2', { class: 'card__title' }, str('week.expectTitle', 'What to expect')),
      grid,
      expect.newThisWeek
        ? el('p', { class: 'expect__new' }, [
            el('strong', {}, `${str('week.newThisWeek', 'New this week')}: `), expect.newThisWeek])
        : null,
    ].filter(Boolean));
  }

  function noDateEl() {
    const host = el('div', { class: 'stack' });
    host.appendChild(el('div', { class: 'empty' }, [
      el('p', { class: 'empty__title' }, str('week.noDate', 'Set the due date and this fills in')),
      el('p', {}, str('week.noDateBody', '')),
    ]));
    const button = el('button', { class: 'btn btn--primary', type: 'button' }, str('week.setDate', 'Set the date'));
    button.addEventListener('click', () => { if (typeof ctx.openSettings === 'function') ctx.openSettings(); });
    host.appendChild(button);
    return host;
  }

  function render() {
    inner.replaceChildren();
    const position = currentPosition();
    if (!position) { inner.appendChild(noDateEl()); return; }

    const data = getData();
    const week = entryForWeek(data.weeks || [], position.week);
    const stage = stageFor(position.day);
    const dates = datesForWeek(position.week);

    const host = el('div', { class: 'stack' });

    // The header: which week, what that is in real dates, how old bub is.
    const label = position.week < 0
      ? str('week.beforeLabel', 'Before bub')
      : str('week.weekLabel', 'Week {week}').replace('{week}', position.week);
    host.appendChild(el('header', { class: 'weekhead' }, [
      el('p', { class: 'weekhead__eyebrow' }, label),
      el('h1', { class: 'weekhead__title' }, week ? week.title : str('week.title', 'This week')),
      el('p', { class: 'weekhead__meta' }, [
        dates ? `${shortDate(dates.start)} to ${shortDate(dates.end)}` : '',
        hasArrived() || position.daysToGo ? ` · ${ageLabel(position)}` : '',
      ].join('')),
    ]));

    if (week && week.headline) host.appendChild(el('p', { class: 'weekhead__line' }, week.headline));

    const expect = expectEl(week && week.expect);
    if (expect) host.appendChild(expect);

    // This week's focuses, each one tickable and shared across both phones.
    if (week && Array.isArray(week.focuses) && week.focuses.length) {
      const list = el('div', { class: 'ingredients' });
      week.focuses.forEach((focus, i) => {
        list.appendChild(tickRow(`week:${week.week}:focus:${i}`, focus, null, null));
      });
      host.appendChild(el('section', { class: 'card' }, [
        el('h2', { class: 'card__title' }, str('week.focusesTitle', 'This week')),
        list,
      ]));
    }

    if (week && Array.isArray(week.learn) && week.learn.length) {
      const rows = el('div', { class: 'rows' });
      for (const id of week.learn) {
        const howto = (data.howtos || []).find((h) => h.id === id);
        if (!howto) continue;
        const row = el('button', { class: 'row', type: 'button' }, [
          el('span', { class: 'row__emoji', aria: { hidden: 'true' } }, howto.emoji || ''),
          el('span', { class: 'row__label' }, howto.name),
          el('span', { class: 'row__chev', aria: { hidden: 'true' }, html: icon('chevron-right', { size: 20 }) }),
        ]);
        row.addEventListener('click', () => { if (typeof ctx.openHowto === 'function') ctx.openHowto(id); });
        rows.appendChild(row);
      }
      if (rows.childElementCount) {
        host.appendChild(el('section', { class: 'card' }, [
          el('h2', { class: 'card__title' }, str('week.learnTitle', 'Worth learning')), rows,
        ]));
      }
    }

    if (week && week.heads_up) {
      host.appendChild(el('div', { class: 'callout callout--do' }, [
        el('span', { html: icon('circle-alert', { size: 20, cls: 'callout__icon' }) }),
        el('p', {}, [el('strong', {}, `${str('week.headsUp', 'Heads up')}: `), week.heads_up]),
      ]));
    }

    // The stage band underneath: the longer arc this week sits inside.
    if (stage) {
      const checklist = el('div', { class: 'ingredients' });
      for (const item of stage.checklist || []) {
        checklist.appendChild(tickRow(`stage:${stage.id}:${item.id}`, item.text, item.detail, item.howto));
      }
      const done = (stage.checklist || []).filter((i) => sync.get(`stage:${stage.id}:${i.id}`, false)).length;

      host.appendChild(el('section', { class: 'card' }, [
        el('h2', { class: 'card__title' }, stage.name),
        el('p', { class: 'caption' }, stage.headline || ''),
        el('h3', { class: 'caption' }, [
          str('week.checklistTitle', 'Things to do'),
          el('span', { class: 'pill' }, str('week.done', '{n} done').replace('{n}', `${done}/${(stage.checklist || []).length}`)),
        ]),
        checklist,
      ]));

      if (Array.isArray(stage.appointments) && stage.appointments.length) {
        const rows = el('div', { class: 'rows' });
        for (const appt of stage.appointments) {
          rows.appendChild(el('div', { class: 'row row--static' }, [
            el('span', { class: 'row__label' }, [
              el('strong', {}, appt.what),
              el('span', { class: 'caption' }, appt.when),
            ]),
          ]));
        }
        host.appendChild(el('section', { class: 'card' }, [
          el('h2', { class: 'card__title' }, str('week.appointmentsTitle', 'Coming up')), rows,
        ]));
      }
    }

    inner.appendChild(host);
  }

  sync.subscribe(() => { if (root.classList.contains('is-active')) render(); });

  return { id: VIEW_ID, el: root, root, onEnter: render };
}
