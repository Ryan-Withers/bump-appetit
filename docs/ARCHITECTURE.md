# Bump Appetit architecture contract

This is the shared contract every module in the app builds against. It exists so
the file layout, the module boundaries, the CSS class names and the data shapes
are decided once and never guessed at.

Companion docs: `bump-appetit-project-plan.md` (content, sources, food tiers) and
`bump-appetit-build-spec.md` (design and engineering). Where this file and the
build spec disagree on a name, this file is the one the code follows.

House rules that apply to every file in the repo:

- No em dash characters anywhere. Use a hyphen or rewrite the sentence. The
  validator fails the build on one.
- Australian spelling everywhere, in code and in copy.
- No build step. Plain HTML, CSS and native ES modules. Nothing is compiled.
- No framework, no bundler, no runtime dependency other than the vendored
  `assets/vendor/fuse.basic.min.mjs`.

## 1. File layout

```
index.html                     single page, all four views plus the sheet host
manifest.webmanifest
sw.js                          service worker, precache plus stale-while-revalidate
.nojekyll                      stops GitHub Pages running Jekyll over the repo
assets/
  styles.css                   the whole design system, one file
  fonts/                       self-hosted variable woff2, latin subset
    bricolage-grotesque-latin.woff2   wght 600-800, opsz pinned
    nunito-sans-latin.woff2           wght 400-700, opsz pinned
  icons/                       apple-touch-icon.png, icon-192, icon-512, maskable-512
  vendor/fuse.basic.min.mjs    Fuse.js 7.1.0, vendored so offline works
  js/
    config.js                  CONFIG constant, the only file Ryan edits to deploy
    strings.js                 every user-facing string
    icons.js                   inline Lucide SVG sprite
    util.js                    dom helpers, text normalisation, storage
    data.js                    loads and indexes data/*.json
    search.js                  Fuse setup, normalisation, ranking
    sticker.js                 verdict sticker markup, stamp animation, confetti
    sheet.js                   generic bottom sheet
    router.js                  view switching and History API wiring
    verdict.js                 the food verdict sheet
    trackers.js                caffeine and fish tracker logic plus sheets
    scanner.js                 Path B worker client and Path A OCR fallback
    app.js                     bootstrap
    views/
      search.js  scan.js  bites.js  more.js
data/
  foods.json  meals.json  lexicon.json  sources.json  cheatsheets.json  caffeine.json
worker/
  scan-worker.js  wrangler.toml
scripts/
  build-icons.js  validate.js  test-search.js
.github/workflows/
  ci.yml  deploy-worker.yml
SOURCES.md  README.md  docs/ARCHITECTURE.md
```

## 2. Data contracts

Every data file is a JSON object with a single named key, never a bare array, so
metadata can be added later without breaking the loader.

### data/foods.json

```json
{
  "schema": 2,
  "foods": [ { "...": "entry" } ]
}
```

Entry shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | kebab-case, globally unique, stable. It is used in localStorage favourites, so never renamed casually |
| `name` | string | yes | Display name, sentence case |
| `emoji` | string | yes | Exactly one emoji |
| `aliases` | string[] | yes | Lowercase, at least 3 characters each, globally unique across every food |
| `group` | string | yes | One of the eight canonical groups below |
| `tier` | string | yes | `green`, `yellow`, `red` or `depends` |
| `why` | string | yes | 220 characters max. One or two sentences, warm voice |
| `variants` | array | only when `tier` is `depends` | At least 2. Each `{ label, tier, why, makeItGreen? , swap? }` with `tier` in green/yellow/red |
| `makeItGreen` | string or null | yes | The condition that flips a red or yellow. Null when there is not one |
| `swap` | string or null | yes | The craving substitute. Null when there is not one |
| `sources` | string[] | yes | At least one key that exists in sources.json |
| `flags` | string[] | yes | `confirm` marks a row still pending Ryan's sign-off. Empty array otherwise |
| `popularity` | 1-3 | yes | 3 is a very common search, 1 is a long-tail entry. Breaks ranking ties |
| `reviewed` | string | yes | `YYYY-MM` |
| `split` | object | no | The honest 50-50 panel, for foods where the sources genuinely disagree or never weigh in. `{ note, positions: [{ label, says, source? }] }` with at least 2 positions, `note` and each `says` 220 max, `source` optional but must exist in sources.json. The tier still carries the stricter call; the panel shows both sides verbatim |
| `nutrition` | object | no | The per-serve panel: `{ serve, kj, protein, fat, satFat, carbs, sugars, fibre, sodium }`. All nine required when present. `serve` is plain English, 28 chars max; `kj` and `sodium` are integers, the rest grams to one decimal. The validator enforces satFat <= fat, sugars <= carbs, and that `kj` agrees with the macros within 25% (17/17/37/8 kJ per gram for protein/carbs/fat/fibre), so a guessed number fails the build. Alcohol-carrying entries are exempt from the energy check by id |
| `nutrients` | object | no | Pregnancy nutrient chips, e.g. `{ "folate": "high", "iron": "med" }`. Keys from the closed set folate, iron, calcium, protein, omega3, iodine, fibre; levels high, med, low. Only notable nutrients are listed; the sheet renders them in fixed order, in a berry palette deliberately distinct from the tier colours |

Rule the validator enforces: every red entry and every red variant must carry a
`makeItGreen` or a `swap`. Kindness is a build check, not a guideline.

The eight canonical `group` values, which are also the browse tiles:

`Cheese & dairy`, `Meat & poultry`, `Fish & seafood`, `Eggs`,
`Fruit & veg`, `Drinks`, `Pantry & sweets`, `Takeaway`

### data/sources.json

```json
{
  "sources": {
    "rwh-2026": {
      "label": "Royal Women's",
      "name": "Royal Women's Hospital, Food safety in pregnancy",
      "url": "https://www.thewomens.org.au/health-information/pregnancy-and-birth/a-healthy-pregnancy/food-safety-in-pregnancy",
      "approved": "2026-07-31"
    }
  }
}
```

Keys in use: `rwh-2026`, `monash-ivf`, `nswfa`, `fsanz`, `pbb`, `betterhealth`,
`eatforhealth`, `fsic`.

### data/meals.json

```json
{
  "meals": [
    {
      "id": "toastie-loophole",
      "name": "The Toastie Loophole",
      "emoji": "🥪",
      "dish": "Ham and cheese toastie",
      "punLine": "Deli ham's redemption arc: steaming hot counts as cooked.",
      "type": "meal",
      "tags": ["5-minute", "craving-buster", "comfort"],
      "ingredients": ["Bread", "Ham", "Tasty cheese", "Butter"],
      "steps": ["Butter the outsides of two slices.", "Stack ham and cheese."],
      "reviewed": "2026-07"
    }
  ],
  "swaps": [ { "craving": "Soft serve", "swap": "Tub ice cream, or frozen-banana nice cream" } ]
}
```

`dish` is required, 60 characters max: the plain what-it-actually-is line shown
on the card and the sheet, because the pun name alone made her tap in to find
out what the recipe was. The pun is the personality; the dish line is the
information. The long `punLine` renders only in the opened sheet.

`type` is `snack` or `meal`. `tags` come from this closed set:
`craving-buster`, `nausea-friendly`, `iron-boost`, `calcium`, `omega-3`,
`5-minute`, `lunchbox`, `freezer-friendly`, `date-night`, `sweet-treat`,
`comfort`.

### data/lexicon.json

```json
{
  "terms": [
    { "match": ["hollandaise", "bearnaise", "benedict"], "tier": "red",
      "why": "Raw-egg sauce.", "makeItGreen": "Ask for firm-cooked eggs and no hollandaise." }
  ],
  "cookedSignals": ["grilled", "well done", "steaming", "baked", "roasted"]
}
```

`match` strings are lowercase and matched longest-phrase-first with word
boundaries. `cookedSignals` raise confidence but never override a red term.

### data/caffeine.json

```json
{
  "limitMg": 200,
  "drinks": [ { "id": "espresso", "name": "Espresso coffee", "emoji": "☕", "mg": 90 } ],
  "note": "Values are averages. Brew strength varies."
}
```

### data/cheatsheets.json

```json
{
  "sheets": [
    { "id": "cafe-brunch", "name": "Cafe brunch", "emoji": "🥑",
      "intro": "One screen for the benny trap.",
      "rows": [ { "tier": "green", "text": "Smashed avo on toast, all clear." } ],
      "asks": ["Can I get the eggs firm, please?"] }
  ]
}
```

## 3. Module API

Every module is a native ES module. `index.html` loads exactly one script:
`<script type="module" src="assets/js/app.js">`.

### util.js

```js
export function $(sel, root = document);
export function $$(sel, root = document);          // returns a real Array
export function el(tag, props = {}, children = []); // tiny hyperscript, sets
                                                    // className, textContent, dataset,
                                                    // aria-*, on* handlers, html
export function normalise(str);        // lowercase, strip punctuation, fold diacritics
                                       // (NFD + strip combining marks), collapse whitespace
export function stripFiller(str);      // removes leading filler tokens, see search.js
export function hashString(str);       // stable non-negative 32-bit int
export function pick(arr, seed);       // arr[hashString(seed) % arr.length]
export function prefersReducedMotion();
export function todayKey();            // YYYY-MM-DD in local time
export const store = {                 // localStorage, all keys prefixed 'ba:',
  get(key, fallback), set(key, value), del(key)   // never throws
};
export function onceRaf(fn);
export function clamp(n, min, max);
```

### icons.js

```js
export function icon(name, { size = 24, cls = '' } = {});  // returns an SVG string
```

Names available: `search, camera, cookie, menu, heart, circle-check, circle-alert,
circle-x, chevron-right, x, arrow-left, phone, sparkles, refresh-cw, wifi-off,
sun, moon, flame, coffee, fish, share, plus, undo, external-link, image`.
All 24x24 viewBox, `stroke-width: 1.8`, `stroke: currentColor`, `fill: none`.

### data.js

```js
export async function loadData();   // fetches all six data files in parallel, caches
export function getData();          // the loaded bundle, throws if called before loadData
// bundle shape: { foods, meals, swaps, lexicon, cookedSignals, sources, sheets, caffeine }
export function foodById(id);
export function groups();           // [{ group, emoji, count }] in canonical order
export function sourceLabel(key);   // short label for a source chip
```

### search.js

```js
export function initSearch(foods);
export function search(query, limit = 5);
// returns { query, normalised, results: [{ food, score, kind }], soft }
//   kind: 'exact-name' | 'exact-alias' | 'fuzzy'
//   soft: true when the best score is worse than 0.5, so the UI says "Closest match"
export function browseGroup(group);   // all foods in a group, popularity desc then name
```

### sticker.js

```js
export const TIERS = {
  green:   { word: 'YES!',     icon: 'circle-check', cls: 'go' },
  yellow:  { word: 'LIMIT',    icon: 'circle-alert', cls: 'easy' },
  red:     { word: 'NOT NOW',  icon: 'circle-x',     cls: 'hold' },
  depends: { word: 'DEPENDS',  icon: 'circle-alert', cls: 'depends' }
};
export function stickerHtml(tier, { mini = false } = {});
export function playStamp(stickerEl, tier);   // adds .reveal, fires confetti on green
```

### sheet.js

```js
export function openSheet({ id, label, build, onClose });
// build(contentEl) fills the sheet body. label is the accessible name.
export function closeSheet({ fromHistory = false } = {});
export function isSheetOpen();
```

The sheet owns: backdrop, drag to dismiss, focus trap, Escape, body scroll lock,
and restoring focus to whatever opened it. It calls `router.pushSheet(id)` when it
opens and `history.back()` when it closes normally.

### router.js

```js
export function initRouter({ views, onEnter, onLeave });
export function go(viewId, { push = true } = {});
export function currentView();
export function pushSheet(id);
export function replaceStateForSheetClose();
```

History model: every view switch is `pushState({ view })`, every sheet open is
`pushState({ view, sheet })`. On `popstate`, if a sheet is open it closes first
and the view does not change. This is what makes the iOS edge-swipe feel native.

### views/*.js

```js
export function createSearchView(ctx);   // and createScanView, createBitesView, createMoreView
// each returns { id, el, onEnter(), onLeave() }
```

`ctx` is `{ data, strings, config, go, openSheet, openFoodSheet, openMealSheet }`.
`onLeave` saves scroll position, `onEnter` restores it.

### verdict.js

```js
export function openFoodSheet(food, { fromEl } = {});
```

### trackers.js

```js
export function openCaffeineSheet();
export function openFishSheet();
export function caffeineToday();   // { totalMg, entries, limitMg }
```

### scanner.js

```js
export async function scanWithWorker(blob, { signal });  // Path B
export async function scanWithOcr(blob, { onProgress });  // Path A
export function groupDishes(dishes);   // { red: [], yellow: [], green: [], unsure: [] }
```

## 4. CSS class inventory

BEM-ish, flat, no nesting deeper than two levels. Written against the tokens in
build spec section 2, which are copied into `:root` verbatim.

Shell: `.app`, `.view`, `.view.is-active`, `.view__inner`, `.tabbar`, `.tab`,
`.tab.is-active`, `.tab__icon`, `.tab__label`.

Search: `.greeting`, `.greeting__sub`, `.searchbar`, `.searchbar__input`,
`.searchbar__icon`, `.searchbar__clear`, `.chips`, `.chip`, `.chip.is-on`,
`.results`, `.result`, `.result__emoji`, `.result__name`, `.result__sticker`,
`.empty`, `.empty__emoji`, `.empty__title`, `.tiles`, `.tile`, `.tile__emoji`,
`.tile__name`, `.tile__count`, `.recents`, `.soft-label`.

Sticker: `.sticker`, `.sticker--go|--easy|--hold|--depends`, `.sticker--mini`,
`.sticker__word`, `.sticker.reveal`, `.confetti`, `.confetti__bit`.

Sheet: `.sheet-backdrop`, `.sheet`, `.sheet.is-open`, `.sheet__handle`,
`.sheet__close`, `.sheet__body`, `.sheet__fav`.

Verdict: `.verdict__emoji`, `.verdict__name`, `.verdict__why`, `.callout`,
`.callout--green`, `.callout__icon`, `.swap`, `.split`, `.split__note`,
`.nutrients`, `.nutrients__title`, `.nutrients__row`, `.nutrient`, `.nutrient--high`, `.nutrient--med`,
`.nutrition`, `.nutrition__head`, `.nutrition__title`, `.nutrition__serve`, `.nutrition__grid`,
`.nutrition__note`, `.ntile`, `.ntile--hero`, `.ntile__value`, `.ntile__unit`, `.ntile__label`,
`.ntile__sub`,
`.split__position`, `.split__who`, `.variants`, `.variant`,
`.variant__label`, `.variant__why`, `.sources`, `.source-chip`, `.checked`.

Scan: `.scan`, `.scan__button`, `.scan__preview`, `.scan__line`, `.scan__status`,
`.dish`, `.dish__name`, `.dish__why`, `.group-title`, `.asks`.

Bites: `.bite`, `.bite__emoji`, `.bite__name`, `.bite__dish`, `.bite__pun`, `.tags`, `.tag`, `.ingredient`,
`.ingredient.is-done`, `.steps`, `.swaps`, `.swap-row`.

More: `.rows`, `.row`, `.row__label`, `.row__chev`, `.calm`, `.calm__step`,
`.callbtn`, `.bar`, `.bar__fill`, `.bar__seg`, `.dots`, `.dot`, `.dot.is-on`.

Shared: `.btn`, `.btn--primary`, `.btn--ghost`, `.card`, `.caption`, `.disclaimer`,
`.toast`, `.install-hint`, `.sr-only`, `.stack` (vertical rhythm helper), and
`.icon`, which `icons.js` stamps on every SVG it returns.

## 5. Bootstrap order (app.js)

1. Set the `is-standalone` class on `<html>` when running as an installed PWA.
2. `await loadData()`, then `initSearch(foods)`.
3. Build the four views, `initRouter`.
4. Register the service worker, wire the update toast.
5. Pick one encouragement line per app open and put it in the footer.
6. Show the iOS install hint if not installed, on iOS Safari, and not dismissed.

A 300ms-delayed spinner is the only loading indicator allowed, and only on this
first data load. Search itself never shows a spinner.
