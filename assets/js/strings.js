// Every user-facing string in Bump Appetit lives here, and nowhere else.
//
// The point of this file: the whole voice of the app can be retuned from this
// one place without touching a line of logic. If you find copy hardcoded in a
// view, a sheet or the markup, that is a bug, and the fix is to move it here.
//
// House rules for anything you add or reword:
//   - No em dash characters. A hyphen, a comma or a colon, or rewrite it.
//   - Australian spelling: pasteurised, yoghurt, flavour, colour, litre.
//   - No bossy modal verbs, and never tell her what she is obliged to do.
//     Prefer "the safe way is..." or "go for..." instead.
//   - Warm, specific, second person, zero guilt, a little cheeky. Never scary,
//     never judgemental, never "you have to".
//   - Puns have a container. They live ONLY in greetings, verdict openers,
//     recipe names and empty states. They never appear in buttons, errors, the
//     Oops group, or source labels. That boundary is the whole reason the jokes
//     land: the app is playful right up until the moment accuracy matters.
//   - Straight ASCII apostrophes only.
//
// Interpolation tokens are in braces and are replaced by the caller:
// {name} {query} {n} {mg} {limit} {left} {date} {number} {days}.

// Tab labels are read twice: router.js looks up STRINGS.tabs.<viewId> when it
// builds the bar, and the ui group below re-exposes the same object so every
// label in the app is findable in one place. One object, so one edit.
const TABS = Object.freeze({
  search: 'Search',
  scan: 'Scan',
  bites: 'Bites',
  more: 'More',
});

export const STRINGS = Object.freeze({
  /* ------------------------------------------------------------------ app
     The name and the one-liner. Used in the About sheet and the first-load
     screen, and nowhere near a verdict. */
  app: {
    name: 'Bump Appetit',
    tagline: 'You grow the human, we check the menu.',
    loading: 'Getting the cookbook out...',
  },

  /* ------------------------------------------------------------- greetings
     Top of the Search screen, one line, chosen by the clock. `from` and `to`
     are 24-hour local times, `to` exclusive. The night bucket is the one that
     wraps past midnight, which is why its `from` is bigger than its `to`.
     {name} comes from CONFIG.name. Puns are welcome here. */
  greetings: [
    { id: 'morning', from: 5, to: 11, text: 'Morning, {name} ☀️' },
    { id: 'lunch', from: 11, to: 14, text: "Lunch o'clock, legend" },
    { id: 'arvo', from: 14, to: 17, text: 'Arvo snack scouting?' },
    { id: 'dinner', from: 17, to: 21, text: "What's for dinner, {name}?" },
    { id: 'night', from: 21, to: 5, text: '3am club 🌙 no judgement, only snacks' },
  ],

  /* -------------------------------------------- search screen (build spec 5.1)
     searchSub sits under the greeting. searchPlaceholder is the field's own
     placeholder. starterChips are the tappable examples under the field: one
     per tier, so the traffic light system teaches itself with zero instructions.
     `query` is what gets searched, `label` is what she reads. */
  searchSub: 'Type a food. Get a straight answer.',
  searchPlaceholder: 'brie, sushi, flat white...',
  starterChips: [
    { emoji: '🧀', label: 'brie', query: 'brie' },
    { emoji: '☕', label: 'flat white', query: 'flat white' },
    { emoji: '🍣', label: 'sushi', query: 'sushi' },
    { emoji: '🥑', label: 'avo toast', query: 'avocado toast' },
    { emoji: '🍦', label: 'soft serve', query: 'soft serve' },
  ],

  /* ----------------------------------------------- the rest of the search view
     Row headings, the live-region count, the honesty label for a weak match,
     and the browse tiles below the fold. Button labels live in `ui`. */
  search: {
    recentsTitle: 'Recent',
    resultsNone: 'No matches',
    resultsOne: '1 match',
    resultsMany: '{n} matches',
    softLabel: 'Closest match',
    softNote: 'Not a confident match, so read it as a hint rather than an answer.',
    browseTitle: 'Or have a browse',
    browseCount: '{n} foods',
    filtersLabel: 'Filter by verdict',
    filters: {
      all: 'All',
      green: 'Yes',
      yellow: 'Limit',
      red: 'Not now',
    },
  },

  /* ---------------------------------------------------------------- tiers
     The sticker words. sticker.js reads `word` for the badge and `spoken` for
     screen readers, because a shouted "NOT NOW" is not a sentence. `label` is
     the sentence-case version used in filter chips and scan group headings. */
  tiers: {
    green: { word: 'YES!', spoken: 'yes', label: 'Yes' },
    yellow: { word: 'LIMIT', spoken: 'limit', label: 'Limit' },
    red: { word: 'NOT NOW', spoken: 'not now', label: 'Not now' },
    depends: { word: 'DEPENDS', spoken: 'depends', label: 'Depends' },
  },

  /* ------------------------------------------------------- verdict openers
     The bold few words in front of the "why" on a verdict card. Picked by a
     stable hash of the food id, so brie gets the same opener every single time
     and the app reads as if a person wrote it rather than as if it rolled dice.
     This is a pun zone, with one rule: the joke never obscures the fact, and a
     red opener is never flippant about a real safety rule and never, ever
     implies she got something wrong. */
  verdictOpeners: {
    green: [
      'Grate news!',
      'Green light, legend.',
      'Tuck in!',
      'Yes, and yum.',
      'All clear.',
      'Good news.',
      'This one is a straight yes.',
    ],
    yellow: [
      'Go for it, within the limit.',
      'A sometimes thing.',
      'Yes, with a cap on it.',
      'Yours, in moderation.',
      'Fine in small doses.',
      'Worth keeping a tally.',
    ],
    red: [
      'Not this one, sorry legend.',
      'Benched for now.',
      'Park this one for a bit.',
      'Not right now.',
      'This one waits for you.',
      'One for the other side.',
    ],
    depends: [
      "It depends, here's the split:",
      "Depends how it's served:",
      'Two answers here, take your pick:',
      'This one splits in two:',
      'Depends on the version:',
    ],
  },

  /* -------------------------------------------------- the verdict sheet (5.2)
     Labels and the footer of the hero screen. `checked` takes {date} from
     CONFIG.reviewedLabel. `flagConfirm` is shown on entries still flagged for
     Ryan to re-read against the source: saying so out loud is the whole trust
     model. */
  verdict: {
    makeItGreen: 'Make it green',
    swap: 'Craving fix',
    dependsLead: "Depends how it's served:",
    variantsHint: 'Tap a version for the detail',
    sources: 'Sources',
    checked: 'Checked {date}',
    howWeDecide: 'How we decide',
    favourite: 'Save to favourites',
    unfavourite: 'Remove from favourites',
    flagConfirm: 'Ryan is double-checking this one against the source.',
  },

  /* ------------------------------------------------------------ how we decide
     A sheet, opened from the quiet link in every verdict footer and from the
     More screen. Three or four short paragraphs, no jokes: this is where the
     app explains why it can be trusted. */
  howWeDecide: {
    title: 'How we decide',
    body: [
      'Three answers, and the colour is never doing the work on its own. Yes means safe with normal food handling. Limit means safe up to a cap, like caffeine or high-mercury fish. Not now means it waits, and it always comes with a way to make it work or something to eat instead.',
      'Everything here comes from Australian sources only. Overseas advice genuinely differs, so matching what your midwife is reading means nothing here contradicts what you get told at your appointments.',
      "When two approved sources disagree, the stricter one wins and the card says so. Royal Women's puts high-mercury fish at once a fortnight where Monash IVF says once a week, so this app says fortnight.",
      "Every card carries the sources it came from and the month it was last checked. If a date looks old, it means a human has not re-read that fact sheet yet. That is Ryan's job, not yours.",
    ],
  },

  /* ----------------------------------------------------------- encouragement
     Footer rotator. One line per app open, not per view: repetition cheapens
     it. Warm and plain, no puns down here. */
  encouragement: [
    "You're growing a human. Snacks are allowed. Encouraged, even.",
    'One day at a time, one safe snack at a time.',
    'Little one is lucky: their mum checks.',
    "Cravings are valid. We'll find the safe version.",
    "You've got this, and dinner's got you.",
    'Checking is caring. Also, seconds are allowed.',
    "Nobody memorises a fact sheet. That's what this is for.",
    'Hungry at odd hours is normal. So is a second breakfast.',
    "You are allowed to enjoy your food. That's rather the point.",
    'Fed and calm beats perfect, every time.',
    "Whatever you eat tonight, you're doing right by them.",
    'Every safe snack is a small act of love. Even the beige ones.',
  ],

  /* ------------------------------------------------------ empty state (5.1.6)
     No search results. Puns allowed, but the golden fallback rule is the real
     payload and it never changes wording lightly. The two buttons come from
     ui.buttons.suggest and ui.buttons.clearSearch. */
  empty: {
    emoji: '🤔',
    title: "Hmm, '{query}' isn't in my cookbook yet.",
    sub: 'Not in the book, not a drama.',
    body: 'When in doubt: freshly cooked, steaming hot, from a clean kitchen is the safest bet.',
    aside: "Worth a quick word with your midwife too, especially if it is on tonight's menu.",
  },

  /* ----------------------------------------------------------- scan (5.4)
     The scanner screen, start to finish: idle, the rotating lines while it
     reads, the results groups, the questions to ask staff, and the errors.
     Errors get no jokes at all, ever. */
  scanning: {
    idleTitle: 'Snap the menu',
    idleCaption: "Point at any menu. I'll sort it into Yes, Limit and Not now.",
    tips: 'Best shots: flat menu, good light, fill the frame',
    privacy: 'Your photo is sent away to be read, and it is not kept afterwards. Menus only, and nothing else on your phone is touched.',
    previewTitle: 'Happy with that shot?',
    lines: [
      "Reading the menu so you don't have to squint...",
      'Checking the fine print for sneaky hollandaise...',
      'Consulting the fridge rules...',
      'Nearly there, hold your appetite...',
    ],
    progressStatic: 'Reading the menu...',
    groups: {
      red: 'Not now',
      yellow: 'Limit',
      green: 'Yes',
      unsure: 'Unsure',
    },
    unsureLead: 'These ones need a human. The kitchen knows, and asking is completely normal.',
    asksTitle: 'Magic questions for the staff',
    asks: [
      'Is the mayo from a jar?',
      'Can that be cooked through?',
      'Was the sushi made fresh today?',
      'Is the fish of the day flake?',
    ],
    guide: "Scanner's a guide, not a guarantee. When unsure, ask the staff or search the food above.",
    noEndpointTitle: 'Smart scanner is switched off',
    noEndpointBody: 'Basic on-device reading is available instead. It never sends your photo anywhere, and it reads plain menu fonts best.',
    errors: {
      offline: {
        title: 'Scanner needs internet',
        body: 'Search still works! Bites, cheat sheets and the trackers all work offline too.',
      },
      unreadable: {
        title: "Couldn't read that one",
        body: 'Try flattening the menu and getting closer. Good light helps more than a steady hand.',
      },
      dailyLimit: {
        title: "That's today's scans used up",
        body: 'The scanner has a daily cap so it stays free to run. It resets tomorrow, and search has every food in the cookbook in the meantime.',
      },
      timeout: {
        title: 'That one took too long',
        body: 'The connection dropped out somewhere. Have another go, or search the dish by name.',
      },
      generic: {
        title: 'The scanner tripped on that one',
        body: 'Nothing lost. Try another photo, or search the dish by name.',
      },
    },
  },

  /* --------------------------------------------------- oops, I ate it (5.6)
     The calmest screen in the app and the reason it exists at 2am. No puns, no
     jokes, no cleverness, plain warm sentences. Nothing here ever implies she
     did something wrong, because she did not. Helpline numbers come from
     CONFIG.helplines, not from this file. */
  oops: {
    title: 'Oops, I ate it',
    opener: 'First: breathe. One-off exposures very rarely cause harm.',
    stepsTitle: 'What to do now',
    steps: [
      'Stop eating it. If it came from a packet, keep the packet or a photo of the label.',
      'Note what it was and roughly when you ate it. That is the first thing a midwife will ask.',
      'Carry on as normal today. There is nothing to take and nothing to fix in the meantime.',
      'Keep an eye on how you feel over the next few days. Most people feel completely fine.',
      'If you feel unwell, or you are simply worried, ring your midwife, GP or one of the numbers below. No question is too small.',
    ],
    symptomsTitle: 'What to watch for',
    symptoms: [
      'A fever or the chills',
      'Aches, tiredness or a flu-like feeling',
      'Vomiting, diarrhoea or stomach cramps',
      'Anything that just feels off to you',
    ],
    symptomsNote: 'Listeria can take a few weeks to show up, so mention the food even if the meal feels like ancient history.',
    callTitle: 'Someone to talk to, any time',
    callNote: 'These lines exist for exactly this question, and they have heard it many times today already.',
    reassure: 'You did nothing wrong. The food rules in pregnancy are fiddly, and everybody lands on this page at some point.',
  },

  /* ------------------------------------------------- caffeine tracker (5.6)
     A budget, not a scoreboard. The bar never turns red and the copy never
     tells her off. Values live in data/caffeine.json. */
  caffeine: {
    title: 'Caffeine today',
    intro: 'The daily budget is 200mg. That is about 1 to 2 espresso coffees, or 3 instants, or 4 to 5 cups of tea.',
    empty: 'Nothing counted yet today. Tap what you drank and the bar does the maths.',
    running: '{mg}mg so far. {left}mg left in the budget.',
    atLimit: "Budget's full for today - decaf's got your back ☕",
    undo: 'Undo last',
    undone: 'Taken back off the tally.',
    note: 'Values are averages, and brew strength varies, so treat the bar as a guide rather than a scoreboard.',
    energyNote: 'Energy drinks sit outside the tally. Caffeine plus guarana is a Not now rather than something to budget for.',
    resetNote: 'The tally clears itself at midnight.',
    barLabel: 'Caffeine used today: {mg} of {limit} milligrams',
  },

  /* ---------------------------------------------------- fish tracker (5.6)
     Fish is a good thing here, so this tracker encourages rather than polices.
     The flake explainer is the whole reason it exists: nobody remembers that
     flake is shark, and the fish and chip shop will not mention it. */
  fish: {
    title: 'Fish tracker',
    intro: 'Fish is encouraged: 1 to 3 serves a week, and a serve is about 150g.',
    weekLabel: 'Other fish serves, this week',
    fortnightLabel: 'High-mercury serve, this fortnight',
    addOther: 'Add a serve',
    addHigh: 'Add a high-mercury serve',
    undo: 'Undo last',
    emptyWeek: 'No serves logged this week yet.',
    weekDone: "That's 3 serves this week, which is the top of the range. Lovely work.",
    fortnightDone: 'High-mercury serve used. Other fish waits until the fortnight window reopens, in {days} days.',
    flakeTitle: 'The flake heads-up',
    flake: 'Flake at the fish and chip shop IS shark. Shark, swordfish, broadbill and marlin carry the most mercury, so it is one serve a fortnight, and no other fish in that fortnight.',
    weekRule: 'Orange roughy (sea perch) and catfish are once a week, with no other fish that week.',
    tinNote: 'A small tin of tuna counts as half a serve, so a few tins across the week is fine.',
    encourage: 'Two serves of cooked-through fish a week is a genuine win for you both.',
    dotsLabel: '{used} of {total} serves used',
  },

  /* ------------------------------------------------------------ myth busters
     Pure reassurance content, rendered as claim then truth. Everything in here
     is a yes, which is the point: most of what she has been told to worry
     about is fine. */
  myths: [
    {
      claim: 'Honey is off the menu.',
      truth: 'Honey is fine for you. It is babies under 1 who miss out, so that rule starts after the birth, not now.',
    },
    {
      claim: 'Peanuts give the baby an allergy.',
      truth: 'Eating peanuts in pregnancy does not cause allergies. Unless you are allergic yourself, peanut butter is a brilliant snack.',
    },
    {
      claim: 'Spicy food brings on labour.',
      truth: 'It does not. It may bring on heartburn, which is a separate conversation, but the curry is yours if you want it.',
    },
    {
      claim: 'Pineapple starts labour.',
      truth: 'Pineapple is a fruit, not an induction. Wash it, cut it at home, enjoy it.',
    },
    {
      claim: 'Pavlova is a raw-egg dessert.',
      truth: 'Baked meringue is cooked meringue. The national treasure stays on the table.',
    },
    {
      claim: 'Chocolate is banned.',
      truth: 'Chocolate is in. It carries a little caffeine, so it counts towards the 200mg day, and that is the only catch.',
    },
    {
      claim: 'All soft cheese is out for nine months.',
      truth: 'Soft cheese comes straight back the moment it is cooked and served hot. Baked brie, lasagne, spanakopita: all yours.',
    },
    {
      claim: 'Vegemite is too salty to bother with.',
      truth: 'Vegemite is a folate hit on toast. Enthusiastically yes.',
    },
  ],

  /* ------------------------------------------------------------- disclaimer
     Footer of every screen, and repeated at the bottom of the About sheet.
     Wording is deliberate: general info, not advice, and always a pointer back
     to her own care team. */
  disclaimer: 'General info from Australian health sources - not medical advice. Always check with your midwife, OB or GP, especially with allergies or conditions like gestational diabetes.',

  /* ---------------------------------------------------------------- sheet
     The generic bottom sheet chrome. sheet.js reads these. */
  sheet: {
    close: 'Close',
    label: 'Details',
    handle: 'Drag down to close',
  },

  /* ------------------------------------------------------------------ tabs
     Read by router.js as tabs.<viewId>. Same object as ui.tabs. */
  tabs: TABS,

  /* ------------------------------------------------------------------- ui
     Every button, row label and bit of chrome. Buttons say exactly what they
     do: no puns, no cleverness, no mystery. If a label makes her pause for even
     a second to work out what happens next, it is the wrong label. */
  ui: {
    tabs: TABS,

    buttons: {
      checkMenu: 'Check this menu',
      snapMenu: 'Snap the menu',
      retake: 'Retake',
      cancel: 'Cancel',
      tryAgain: 'Try again',
      readOnDevice: 'Read it on this phone instead',
      clearSearch: 'Clear search',
      suggest: 'Ask Ryan to add it',
      addToToday: 'Add to today',
      howWeDecide: 'How we decide',
      openSource: 'Open the source page',
      callHelpline: 'Call {name} - {number}',
      back: 'Back',
      done: 'Done',
      update: 'Update now',
      dismiss: 'Maybe later',
    },

    // The More screen list, top to bottom.
    rows: {
      cheatsheets: 'Cheat sheets',
      caffeine: 'Caffeine today',
      fish: 'Fish tracker',
      oops: 'Oops I ate it',
      howWeDecide: 'How we decide',
      about: 'About & sources',
    },

    // Section headings used across the More screen and the sheets it opens.
    sections: {
      myths: 'Myth busters',
      favourites: 'Saved foods',
      swaps: 'Craving something benched?',
    },

    // iOS has no install prompt API, so this hint is the only way in.
    // One-time, dismissible, stored in localStorage.
    installHint: {
      title: 'Make me an app',
      text: "Tap the Share button, then 'Add to Home Screen'.",
      dismiss: 'Maybe later',
    },

    // Service worker found a newer build. Never auto-reloads: she might be
    // mid-search, and yanking the page out from under her is rude.
    updateToast: 'Fresher guidance is ready - tap to update',

    offlineNote: 'You are offline. Search, Bites, cheat sheets and the trackers all still work.',
    savedNote: 'Saved to your favourites.',
    unsavedNote: 'Removed from your favourites.',
  },

  /* ------------------------------------------------------------------ a11y
     Screen-reader-only labels. Plain and literal, never funny: a joke read out
     of context in VoiceOver is just confusing. */
  a11y: {
    skipToContent: 'Skip to content',
    close: 'Close',
    tabs: 'Bump Appetit sections',
    searchField: 'Search foods',
    clearSearch: 'Clear search',
    resultsRegion: 'Search results',
    scanPreview: 'The menu photo you are about to check',
    externalLink: 'Opens in Safari',
  },

  /* ----------------------------------------------------------- bites (5.5)
     Recipe names carry the puns and they live in data/meals.json. Everything
     in here is the furniture around them. */
  bites: {
    title: 'Bump Bites',
    sub: 'Every one of these is green, or yellow inside its limit.',
    filters: [
      { id: 'all', label: 'All' },
      { id: 'snack', label: 'Snacks' },
      { id: 'meal', label: 'Meals' },
      { id: 'sweet-treat', label: 'Sweet' },
      { id: '5-minute', label: '5-minute' },
      { id: 'craving-buster', label: 'Craving buster' },
      { id: 'nausea-friendly', label: 'Nausea-friendly' },
      { id: 'iron-boost', label: 'Iron boost' },
      { id: 'freezer-friendly', label: 'Freezer' },
    ],
    ingredientsTitle: 'What you need',
    stepsTitle: 'How it goes',
    tickHint: 'Tap an ingredient to tick it off while you cook.',
    swapsTitle: 'Craving something benched?',
    swapsLead: 'The craving is valid. Here is the version you can have tonight.',
    empty: 'Nothing matches those filters. Take one off and have another look.',
  },

  /* ------------------------------------------------------------- cheat sheets
     One screen per outing, for when the menu is in her hand and the waiter is
     hovering. Content lives in data/cheatsheets.json. */
  cheatsheets: {
    title: 'Cheat sheets',
    sub: 'One screen per outing, for reading under the table.',
    asksTitle: 'Handy things to ask',
  },

  /* ------------------------------------------------------------------ about
     The About & sources sheet. Honest about what leaves the phone, because
     that is the sort of thing worth being honest about. */
  about: {
    title: 'About & sources',
    intro: 'Bump Appetit is a small app built for one person by someone who loves her. It answers one question fast: can I eat this?',
    sourcesTitle: 'Where the answers come from',
    sourcesIntro: 'Australian sources only, every one of them signed off before it went in. Tap any of them to read the original.',
    freshnessTitle: 'How fresh it is',
    freshness: 'Every entry is re-checked against its source each quarter, and after any relevant Australian food recall. The month on each card is the month it was last read.',
    privacyTitle: 'What leaves your phone',
    privacy: 'No accounts, no cookies, no analytics. Favourites and the trackers stay on your phone. The only thing that ever leaves is a menu photo, and only when you tap Check this menu.',
    credit: 'Made with love by Ryan.',
  },
});
