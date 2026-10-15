# Bub Appetit

A small offline app for two tired people and one newborn. Type what is
happening, get a straight answer, with who to ring when that is the answer.

Built for Ryan and Emma, first baby due April 2027. Melbourne.

## What it does

**Search** 255 answers to the things you actually type at 3am, each one written
from an Australian source in our own words with a link back to the page.

Four verdicts, and the fourth is the point of the app:

| | |
|---|---|
| **ALL NORMAL** | Common, expected, nothing to do. |
| **KEEP AN EYE** | Usually fine, and here is what would change the answer. |
| **CALL SOMEONE** | Ring the nurse, the GP or 000. The number is on the card. |
| **DEPENDS** | Two real answers, and which one you have. |

**Ask** lets you ask in your own words. The phone searches its own notes first
and those are the only thing the model may answer from. It never searches the
web. If the notes do not cover it, it says so and gives you a number.

**Week** runs off one date. Before April it counts down; set the birth date the
day bub arrives and it switches to their real age. Each week says what to
expect in real numbers (feeds, sleep, tummy time in minutes), what to focus on,
and what is coming.

**Track** logs feeds, sleeps and nappies, shared between both phones, so nobody
has to remember whether she has been fed.

**The list** is 79 things to buy, sorted into before day one, first few weeks,
later and borrow, with Australian prices. Day one comes to roughly $1,500.

## Where the answers come from

| Source | Its job |
|---|---|
| [Raising Children Network](https://raisingchildren.net.au) | The spine. Day to day care, settling, crying, development. |
| [Red Nose](https://rednose.org.au) | Safe sleep. **Final say.** If anything conflicts on sleep, Red Nose wins. |
| [Australian Breastfeeding Association](https://www.breastfeeding.asn.au) | Feeding. 24 hour helpline on 1800 686 268. |
| [RCH Kids Health Info](https://www.rch.org.au/kidsinfo) | Illness, fever, rashes, when to see a doctor. |
| [National Immunisation Program](https://www.health.gov.au) | What is due and when. |

Content is summarised, never copied, and every entry links back. That keeps it
legal and keeps it honest when the guidance moves.

## Running it

It is plain HTML, CSS and native ES modules. No build step, no framework, no
dependency except a vendored copy of Fuse.js.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Making it yours

Everything you need to change lives in `assets/js/config.js`: the due date, the
birth date, your hospital and your OB, and the Ask keys. Each phone number is
marked `confirmed: false` until you have rung it once in daylight, and the app
shows an unconfirmed number with a quiet note attached. A wrong number at 2am is
worse than no number.

## Checks

```sh
node scripts/validate.js       # the data contract
node scripts/check-strings.js  # every string lookup resolves
node scripts/test-search.js    # golden queries, including every call answer
node scripts/test-timeline.js  # the week maths
node scripts/test-worker.js    # the Ask refusals and the two-phone merge
```

All five run in CI on every push.

## Not medical advice

General information from Australian health sources. Ring your nurse, your GP or
000 whenever something does not feel right. You will never be told off for
ringing.
