# Bub Appetit architecture contract

The shared contract every module builds against, so names and shapes are
decided once and never guessed at.

House rules, everywhere in the repo:

- No em dash characters. The validator fails the build on one.
- Australian spelling, in code and in copy.
- No build step. Plain HTML, CSS and native ES modules.
- No dependency beyond the vendored `assets/vendor/fuse.basic.min.mjs`.
- Never a medication dose, anywhere, in any file.

## 1. File layout

```
index.html              one page, four view shells, the sheet host
sw.js                   precache plus stale-while-revalidate
assets/
  styles.css            the whole design system, one file
  js/
    config.js           THE file Ryan edits: dates, contacts, Ask keys
    strings.js          every user-facing string
    timeline.js         one date to a week number, and to real dates
    data.js             loads and indexes data/*.json
    search.js           Fuse setup, normalisation, ranking
    ask.js              the AI search client, and the red-flag check
    sync.js             the two-phone store, local first
    notify.js           nudges, honest about what it cannot do
    answer.js           the answer sheet
    sticker.js          the four verdicts, the stamp
    sheet.js            the generic bottom sheet
    router.js           views and the History API
    app.js              bootstrap
    views/              search.js  track.js  week.js  more.js
data/                   entries weeks stages howtos cheatsheets buylist sources
worker/ask-worker.js    /ask and /sync
scripts/                validate, check-strings, test-search, test-timeline,
                        test-worker, merge-entries.py
```

## 2. The four verdicts

| tier | sticker | means |
|---|---|---|
| `normal` | ALL NORMAL | Common, expected, nothing to do. |
| `watch` | KEEP AN EYE | Usually fine; here is what would change it. |
| `call` | CALL SOMEONE | Ring someone, today. `whoToCall` is required. |
| `depends` | DEPENDS | Two real answers; `variants` carries them. |

STRICTER WINS. Between two tiers, take the safer one.

`call` is why the app exists, so its sheet puts the phone button directly under
the sticker, above the explanation. The CSS classes are `ok`, `watch`, `ring`
and `depends`.

## 3. data/entries.json

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, unique, stable (used in saved items) |
| `name` | yes | Unique. Two entries sharing a name means one is unreachable |
| `emoji` | yes | Exactly one |
| `aliases` | yes | Lowercase, 3+ chars, globally unique, never shadowing another entry's name |
| `group` | yes | One of: Sleep, Feeding, Crying, Nappies, Skin & body, Illness, Milestones, You two |
| `tier` | yes | normal, watch, call, depends |
| `why` | yes | 220 max |
| `whatToDo` | no | 220 max |
| `whoToCall` | on `call` only | 000, GP, MCH nurse, Nurse line, ABA helpline, Red Nose line |
| `variants` | on `depends` only | 2+, each tier in normal/watch/call |
| `sources` | yes | Keys from sources.json |
| `link` | yes | https, the page this was summarised from |
| `popularity` | yes | 1 to 3, breaks ranking ties |
| `reviewed` | yes | YYYY-MM |

`whoToCall` is a service name, not a number. `answer.js` resolves it against
`CONFIG.contacts`, so "Nurse line" becomes whichever line is right for where
they live, and an unconfirmed number shows with the doubt attached.

Other files: `weeks.json` (week -6 to 52, `expect`/`focuses`/`learn`),
`stages.json` (six continuous day bands with checklists and appointments),
`howtos.json`, `cheatsheets.json` (must contain `ring-now`), `buylist.json`.

## 4. The timeline

One date drives everything. `birthDate` wins over `dueDate` once set, because
almost nobody arrives on the due date. Week 0 is the first seven days; week -1
is the last week of the pregnancy. Both dates live in localStorage once
Settings has written them, and config only seeds the first run. A value that
will not parse is refused rather than stored, so a typo cannot wipe the date
the whole app runs on.

## 5. Sync

Local first, always. Every write hits localStorage and paints before the
network is consulted, which is the difference between this and every shared
list that feels slow.

Merging is last write wins PER KEY, never per document, so two phones offline
ticking different things both survive. Unacknowledged writes sit in an outbox
until the server echoes them back. Nothing turns on until a household code is
entered: no code, no network, and it is a single phone app that works.

## 6. Ask

Retrieval happens on the phone. The matched entries are the only material the
model is given, and the Worker validates what comes back: a cited note that was
never supplied is dropped, an invented service to ring is dropped, malformed
output is a refusal. No matching notes means no model call at all.

The prompt bans doses and carries a ring-000 override. `ask.js` checks the same
red-flag words itself, so a network problem can never be the reason that is not
shown.
