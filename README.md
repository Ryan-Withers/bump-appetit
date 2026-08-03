# Bump Appetit

A pregnancy food guide for Emma. Built to be saved to her iPhone home screen and
opened one-handed, in a cafe queue or in bed at 3am, and to answer one question
fast: **can I eat this?**

Search a food, get a sticker. Green means yes, amber means within a limit, rose
means not now, and "depends" splits the answer properly instead of guessing.
Every red answer comes with a way to make it green or something to eat instead.
Every verdict shows where it came from and when it was last checked.

There is also a menu scanner, a recipe list, cheat sheets for eating out, a
caffeine tracker and an "oops, I ate it" page. All of it works offline except
the scanner, which says so kindly.

---

## What it costs

Nothing. That is not a rounding error, it is the design.

| Thing | Cost |
|---|---|
| Hosting on GitHub Pages | $0 |
| Search (Fuse.js, vendored into the repo) | $0 |
| The scanner Worker on Cloudflare | $0, free tier is 100k requests a day |
| The vision model behind the scanner | About half a cent per scan on Claude Haiku 4.5, capped at 100 scans a day |
| Domain | $0 on `github.io` |

No accounts, no analytics, no cookies, no tracking, no server. The whole app is
static files served straight out of this repo. There is no database because the
food data **is** the repo.

---

## The rules that never bend

These are checked by CI, so you cannot break them by accident.

1. **No em dash characters anywhere.** Not in copy, not in code, not in
   comments. Use a hyphen or rewrite. The validator sweeps the whole repo.
2. **Australian spelling** in code and copy. The page is `lang="en-AU"`.
3. **No build step, no bundler, no framework.** Native ES modules with relative
   paths. Push to main and it is live. Fuse.js is the only dependency and it
   lives in `assets/vendor/`.
4. **No hardcoded copy.** Every user-facing string lives in
   `assets/js/strings.js`, so you can tune the voice without touching logic.
5. **Red verdicts are never dead ends.** Every red entry carries a
   `makeItGreen` or a `swap`. CI fails the build if one does not.
6. **Nothing ships unsourced.** Every food points at a source key that exists in
   `data/sources.json`, and carries the month it was reviewed.
7. **Colour is never the only signal.** Every tier is colour plus icon plus
   word, for colourblind eyes and for bright sunlight.
8. **Animate transform and opacity only**, and honour
   `prefers-reduced-motion: reduce` everywhere.
9. **Every touch target is at least 44x44**, with a visible focus ring.
10. **Nothing critical lives only in localStorage.** iOS evicts PWA storage.
    Favourites are a convenience; the food data ships with the app.

---

## Editing from your phone

There is no laptop in this workflow, on purpose.

- **Small edits:** open the repo in the GitHub mobile app, or swap `github.com`
  for `github.dev` in the URL to get a real editor in Safari. Edit, commit,
  done.
- **Bigger changes:** kick off a Claude Code session from the Claude iPhone app,
  let it open a pull request, review the diff in the GitHub app, merge.
- **Either way, CI has your back.** Every push and every pull request runs the
  validator and the search tests. A malformed edit fails the checks and simply
  does not deploy. You cannot push a broken `foods.json` to the live app, so
  edit with confidence.

---

## Adding or editing a food

Everything lives in `data/foods.json`, under the `foods` array. Copy an existing
entry, change it, commit. Here is a whole real one:

```json
{
  "id": "pavlova",
  "name": "Pavlova",
  "emoji": "🍰",
  "aliases": [
    "pav", "pavs", "meringue", "meringues", "baked meringue",
    "mini pavlova", "pavlova base", "eton mess", "pavlova roll", "meringue nest"
  ],
  "group": "Eggs",
  "tier": "green",
  "why": "Baked meringue is cooked meringue, so the pav is safe as houses. Top it with cream and fruit you cut at home and enjoy the lot. National treasure: intact.",
  "makeItGreen": null,
  "swap": null,
  "sources": ["rwh-2026"],
  "flags": [],
  "popularity": 2,
  "reviewed": "2026-07"
}
```

Field by field:

| Field | What to put |
|---|---|
| `id` | kebab-case, unique, and **stable forever**. It is the key her favourites are saved under, so renaming one loses a favourite |
| `name` | Sentence case, how it reads on the card |
| `emoji` | Exactly one |
| `aliases` | Lowercase, 3 characters or more, and each one belongs to exactly one food across the whole file. This is where search quality lives: add plurals, misspellings, phrase forms and Australian slang. "pav", "parmy", "chook", "avo", "snag", "hommus", "flat wite" |
| `group` | One of the eight browse tiles: Cheese & dairy, Meat & poultry, Fish & seafood, Eggs, Fruit & veg, Drinks, Pantry & sweets, Takeaway |
| `tier` | `green`, `yellow`, `red` or `depends` |
| `why` | 220 characters max, warm, specific, no guilt, and never the word "should" |
| `makeItGreen` | The condition that flips it. Required on reds unless there is a swap. `null` when there is not one |
| `swap` | The craving substitute. Required on reds unless there is a makeItGreen. `null` when there is not one |
| `sources` | At least one key from `data/sources.json` |
| `flags` | `["confirm"]` while you still want to eyeball it, `[]` otherwise |
| `popularity` | 1 to 3. 3 is a very common search and wins ranking ties |
| `reviewed` | `YYYY-MM` |

**When the honest answer is "it depends"**, set `"tier": "depends"` and add at
least two `variants` instead of picking a side. Each variant is
`{ label, tier, why }` plus a `makeItGreen` or `swap` if it is red:

```json
"tier": "depends",
"why": "Depends how it's served:",
"variants": [
  { "label": "Cooked through, served hot", "tier": "green",
    "why": "Baked, grilled or pan-fried until it flakes, salmon is one of the best things on the menu." },
  { "label": "Smoked or raw", "tier": "red",
    "why": "Cold-smoked salmon and gravlax are ready-to-eat and chilled, which is exactly where listeria likes to sit.",
    "makeItGreen": "Cook it right through in a hot dish and eat it steaming.",
    "swap": "Canned salmon with cream cheese on a toasted bagel gives you the same salty hit." }
]
```

Getting this wrong is the one failure that costs all trust, so the validator is
strict about it. Common trip-ups it will catch for you:

- a red with no `makeItGreen` and no `swap`
- an alias you have already given to another food
- an alias that is another food's name
- a `depends` entry with only one variant
- a source key that is not in `data/sources.json`
- a `why` over 220 characters, which would make the sheet scroll
- an em dash that Notes or autocorrect slipped in

Each of those fails with the exact id and field, so the fix is obvious from a
phone screen.

### The other data files

Same idea, same validator, all in `data/`:

- `meals.json` for Bump Bites recipes and the craving swaps. Tags come from a
  closed set, and every recipe needs ingredients and steps.
- `lexicon.json` for the offline menu scanner keywords.
- `cheatsheets.json` for the eating-out screens.
- `caffeine.json` for the tracker.
- `sources.json` for the source register. See `SOURCES.md` for who they all are.

---

## Running the checks

Two commands, no install step, nothing to download.

```sh
node scripts/validate.js     # data contracts, kindness rule, em dash sweep
node scripts/test-search.js  # golden queries against the real search pipeline
```

`validate.js` is plain Node with zero dependencies. It prints a tidy summary of
counts when everything is fine, and on failure it names the file, the id and the
field, one problem per line.

`test-search.js` imports the actual `assets/js/search.js` and runs a fixture of
golden queries through it, checking the expected food comes back as the **top**
result. Every Australianism, every misspelling and every full-sentence question
in there is a real thing Emma might type.

**When you find a search bug, add a row to the fixture.** One row, forever, so
it can never come back. The rows are `[query, expectedId, expectedTier]` and
they are grouped by what they are testing.

Both scripts run on every push and every pull request via
`.github/workflows/ci.yml`, on Node 22. Nothing deploys unless both pass.

---

## Deploying

Merge to `main`. That is the deploy.

CI runs the validator and the tests, and only if both are green does it upload
the repo root to GitHub Pages and publish. There is no build step because the
repo root already **is** the site.

One-time setup, if Pages has never been switched on: go to Settings > Pages and
set **Source** to **GitHub Actions**. Without that, the deploy job fails with a
permissions error and the checks still pass, which is confusing the first time.

### Bump the service worker version, every single time

`sw.js` starts with a line like:

```js
const VERSION = 'bump-v1';
```

**Change that number on every deploy.** It is the cache key. If you do not bump
it, the service worker keeps serving the old files and your change never reaches
her phone, which looks exactly like the deploy silently failing.

Bump it to `bump-v2`, `bump-v3` and so on. When she next opens the app, the new
worker installs, a toast offers the update, and tapping it reloads into the new
version. It deliberately does not auto-reload, because she might be mid-search.

---

## The scanner Worker

The menu scanner posts a photo to a tiny Cloudflare Worker in `worker/`, which
calls a vision model and returns a tier per dish. It is optional. Leave it
unconfigured and the Scan screen politely offers basic on-device reading
instead.

**Deploying it, from your phone:**

1. Create a Cloudflare account, then a KV namespace called `bump-scan-counter`
   at Storage & Databases > KV. Paste its ID into `worker/wrangler.toml`.
2. Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your Pages origin, scheme
   and host only, no trailing slash.
3. Create a Cloudflare API token with Workers edit permission, and add it to
   this repo as the secret `CLOUDFLARE_API_TOKEN` under Settings > Secrets and
   variables > Actions.
4. Push anything under `worker/`. `.github/workflows/deploy-worker.yml` deploys
   it. Never deploy from a laptop, there is not one.

**Then set the Worker's two secrets**, in the Cloudflare dashboard under
Compute (Workers) > bump-scan > Settings > Variables and Secrets, both as type
Secret:

| Secret | What it is |
|---|---|
| `PASS` | A passphrase you invent. It must match `CONFIG.scanner.pass` in `assets/js/config.js` exactly. Not real security, it just stops a stranger who finds the URL burning the daily quota |
| `MODEL_KEY` | The vision model API key. **Anthropic by default**, from console.anthropic.com > API keys |

Neither of them ever goes in a file in this repo. The repo is public.

The Worker calls Claude Haiku 4.5 with no other variables set, at roughly half a
cent per scan. To use Gemini instead, put a Google key in `MODEL_KEY` and set
`MODEL_PROVIDER = "gemini"` in `worker/wrangler.toml`, **not** as a dashboard
variable: `wrangler deploy` replaces the whole `[vars]` block with what is
committed, so a dashboard variable is wiped by the next push while the secret
survives. That combination would leave a Google key being posted to Anthropic,
and every scan failing with the reason visible only in the Worker logs.

Finally, paste the Worker's `workers.dev` URL into `CONFIG.scanner.endpoint` in
`assets/js/config.js`, along with the same `pass`, and commit. That file is the
only one you need to edit to point the app at your own infrastructure.

---

## Regenerating the icons

The home screen icon is generated, not drawn, so there is no design file to lose:

```sh
node scripts/build-icons.js
```

Zero dependencies, pure Node. It writes `apple-touch-icon.png` (180x180, no
transparency, because iOS composites transparent pixels onto black), plus
`icon-192.png`, `icon-512.png` and `maskable-512.png` into `assets/icons/`.

Change the colours or the tilt at the top of the script and run it again. If you
change the icon, bump the service worker `VERSION` too, or the old one stays
cached.

---

## The quarterly source re-check

Half an hour, four times a year. Put it in your calendar.

1. Open each of the eight sources listed in `SOURCES.md` and skim for changes.
   The Royal Women's sheet is the primary one, so start there.
2. Check the FSANZ recalls page. An Australian food recall is the one thing that
   should trigger an out-of-cycle review, and it is a two minute job.
3. For every entry you actually re-read, bump its `reviewed` field to the new
   `YYYY-MM`. Do not bump entries you did not check: the date on the card is a
   promise.
4. Update `CONFIG.reviewedLabel` in `assets/js/config.js` to the new month. That
   is the "Checked ..." line she sees.
5. Update the approval dates in `data/sources.json` and the sign-off line in
   `SOURCES.md`.
6. Run both scripts, commit, merge, bump the service worker `VERSION`.

If two sources disagree, the stricter one wins and the difference gets noted in
the `why`. If a source is not in `SOURCES.md`, it does not go in the database.
That is the whole rule.

While you are in there: clear out any entry still carrying `"flags": ["confirm"]`
by confirming it or rewording it.

---

## What this app is not

Worth being straight about.

- **It is not medical advice.** It is general information collected from
  Australian health sources and it says so on every screen: "General info from
  Australian health sources - not medical advice. Always check with your
  midwife, OB or GP, especially with allergies or conditions like gestational
  diabetes."
- **It does not know her.** No allergies, no gestational diabetes, no
  medications, no history. It cannot, because it stores nothing about anyone.
- **It does not do symptoms.** If she has eaten something and feels unwell, the
  answer is a phone call, not an app. The "Oops, I ate it" page exists to say
  exactly that and to put Pregnancy, Birth & Baby on 1800 882 436 one tap away.
- **It does not diagnose anything, ever.** Symptom checking and supplement dosing
  are her care team's lane. The app links out instead.
- **The scanner is a helper, not an authority.** It reads a photo of a menu and
  it can misread. Anything it is unsure about it puts in an Unsure pile with the
  questions to ask the staff, rather than guessing.
- **It is not finished.** It is a small app for one person, and the right way to
  change it is to change it. Emma asks for something, it goes in.

---

## Where things live

```
index.html                     one page, four views, one sheet host
sw.js                          service worker. Bump VERSION on every deploy
manifest.webmanifest
assets/
  styles.css                   the whole design system, one file
  fonts/                       self-hosted woff2, so offline keeps its typography
  icons/                       generated by scripts/build-icons.js
  vendor/fuse.basic.min.mjs    the only dependency, vendored
  js/
    config.js                  the only file you need to edit to deploy
    strings.js                 every user-facing string
    ...                        util, data, search, sticker, sheet, router, views
data/                          foods, meals, lexicon, sources, cheatsheets, caffeine
worker/                        the Cloudflare scanner Worker
scripts/
  validate.js                  the quality gate
  test-search.js               the golden queries
  build-icons.js               the home screen icon
.github/workflows/
  ci.yml                       checks on every push, deploys main to Pages
  deploy-worker.yml            ships worker/ to Cloudflare
SOURCES.md                     the approved source register
docs/ARCHITECTURE.md           module contracts and data shapes
```

`docs/ARCHITECTURE.md` is the contract every file is written against. If you are
about to add something and are not sure where it goes, that is the file to read.

Bump Appetit.
