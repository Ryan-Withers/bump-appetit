# Bump Appetit approved source register

Every verdict in this app is traceable. Each food entry in `data/foods.json` carries a
`sources` array of keys, and each key resolves against `data/sources.json`, which is what
puts the little source chip and the "checked Jul 2026" line on the card.

Australian sources only. All eight below were signed off by Ryan on 31 July 2026.

If a source is not in this file, it does not go in the database. That is the whole rule.

---

## The eight approved sources

| Key | Chip label | Who they are | What we use them for |
|---|---|---|---|
| `rwh-2026` | Royal Women's | The Royal Women's Hospital (Melbourne), "Food safety in pregnancy" fact sheet, March 2026 edition | **Primary source.** The full safe / avoid / limit table, listeria, salmonella and toxoplasmosis guidance, caffeine, mercury, liver, and food handling |
| `monash-ivf` | Monash IVF | Fertility and pregnancy specialists; their "Food Safety in Pregnancy" sheet is itself sourced from the Royal Women's | Cross-check and simplified wording |
| `nswfa` | NSW Food Authority | NSW government food safety body | Their pregnancy food table is the most granular in Australia, so it carries the edge cases: enoki mushrooms, bocconcini, fried ice cream, pre-packaged sandwiches, stuffing, sprouts |
| `fsanz` | FSANZ | Federal food standards regulator | Mercury-in-fish serve sizes, listeria detail, caffeine milligram values, the food recalls feed |
| `pbb` | Pregnancy Birth & Baby | Federal government pregnancy service, run by healthdirect | Healthy diet guidance, and the 1800 882 436 helpline on the "Oops, I ate it" page |
| `betterhealth` | Better Health | Victorian government health information service | Toxoplasmosis detail and general pregnancy nutrition |
| `eatforhealth` | Eat for Health | The NHMRC Australian Dietary Guidelines | Serving sizes and the nutrients section: folate, iron, iodine, calcium |
| `fsic` | Food Safety Info Council | Australian food safety charity and educator | Plain-English food handling tips |

The Royal Women's own fact sheet points readers to FSANZ, Pregnancy Birth and Baby, and
Better Health Channel, which is part of why they are here.

Full titles, URLs and approval dates live in `data/sources.json`. Where an organisation's
deep link was not confidently known at build time, the register stores their stable main
site rather than a guessed path that could 404 on Emma mid-cafe-queue.

---

## Deliberately excluded

| Not used | Why |
|---|---|
| Overseas health services (NHS, Mayo Clinic, FDA, CDC) | Their advice genuinely differs. UK "Lion mark" eggs change the runny-egg rules, and US listeria advice splits differently on deli meat. Australian guidance is what Emma's care team follows, so it is what this site follows |
| Mummy-blog listicles and forum threads | No sourcing, no review date, no accountability, and they go stale silently |
| Supplement and food brand content | The brand is selling something. That is a conflict of interest on a page whose only job is an honest verdict |

Also out of scope on purpose: symptom checking, supplement dosing, anything diagnostic.
That is her care team's lane, and the site links out instead.

---

## Ground rules

**1. Aussie sources only.**
UK and US advice differs from ours. Sticking to Australian guidance means nothing on this
site contradicts what her midwife, OB or GP tells her.

**2. Source approval workflow.**
Nothing enters the food database without a source key from the list above. New sources get
proposed to Ryan first. Entries carrying the `confirm` flag are drafted from general
knowledge or a pending source and need a call before they are treated as settled.

**3. Stricter wins.**
When two approved sources disagree, the site shows the stricter advice and notes the
difference on the card. Worked example: Monash IVF says high-mercury fish once a week, the
Royal Women's says once a fortnight, so the site says once a fortnight.

**4. Freshness.**
Every entry carries a `reviewed` date in `YYYY-MM` form, and it is shown on the card. The
register gets a 30-minute re-check against every source each quarter, plus an out-of-cycle
check whenever there is a relevant Australian food recall. The FSANZ recalls feed makes
that a two-minute job.

Next scheduled re-check: October 2026.

---

## Known source conflicts, and how they are resolved

Both of these are live disagreements between approved sources. Both are resolved by
"stricter wins", and both note the difference on the card so nobody thinks it is a typo.

| Food | The disagreement | What the site says |
|---|---|---|
| High-mercury fish (shark or flake, swordfish, broadbill, marlin) | Royal Women's: one serve per fortnight, and no other fish that fortnight. Monash IVF: once a week | **Once a fortnight.** Heads-up baked into the entry: "flake" at the fish and chip shop is shark |
| Rockmelon (cantaloupe) | Royal Women's: fine if it is whole, washed and cut at home. NSW Food Authority: do not eat it at all, because the rough rind traps bacteria that the knife then drags through the flesh | **Skip it for now**, with a swap to a safer fruit. Flipped to red on 31 July 2026 |

If a third conflict turns up, add a row here at the same time as the food entry changes, so
the reasoning never lives only in someone's head.

---

## How to add a source

1. **Propose it to Ryan.** Say what the organisation is, why an existing approved source
   does not already cover the question, and link the specific page.
2. **Get sign-off.** Australian only, and a real health, government, regulator or
   recognised food-safety body. Ryan's yes is what makes it approved, and the date of that
   yes is the `approved` date.
3. **Add the key to `data/sources.json`** with all four fields: `label` (short enough for a
   source chip on a phone-width card), `name` (full title), `url` (stable public page,
   organisation main site if the deep link is not certain), and `approved` (`YYYY-MM-DD`).
4. **Add a row to the table at the top of this file**, covering who they are and what they
   are used for.
5. **Then cite it from food entries** by adding the key to their `sources` array, and bump
   each of those entries' `reviewed` date.

The validator fails the build if any entry cites a key that is not in `data/sources.json`,
so step 3 always comes before step 5.

---

*General info from Australian health sources, not medical advice. Always check with your
midwife, OB or GP, especially with allergies or conditions like gestational diabetes.*
