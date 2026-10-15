// Every user-facing string in Bub Appetit lives here, and nowhere else.
//
// The point of this file: the whole voice of the app can be retuned from this
// one place without touching a line of logic. If you find copy hardcoded in a
// view, a sheet or the markup, that is a bug, and the fix is to move it here.
//
// House rules for anything you add or reword:
//   - No em dash characters. A hyphen, a comma or a colon, or rewrite it.
//   - Australian spelling: nappy, dummy, immunisation, colour, paediatric.
//   - Warm, specific, second person, zero guilt. Never bossy, never scary.
//   - Puns have a container. They live ONLY in greetings and empty states.
//     They never appear in a CALL SOMEONE answer, in an error, or next to a
//     phone number. Somebody reading those is frightened, and the app stops
//     being funny the moment accuracy matters.
//   - Straight ASCII apostrophes only.
//
// Interpolation tokens are in braces: {name} {n} {week} {date} {nutrient}.

const TABS = Object.freeze({
  search: 'Search',
  track: 'Track',
  week: 'Week',
  more: 'More',
});

export const STRINGS = Object.freeze({
  app: {
    name: 'Bub Appetit',
    tagline: 'Two tired people, one straight answer.',
    loading: 'Getting the notes out...',
    loadErrorTitle: 'That did not open',
    loadErrorBody: 'Something got in the way of loading. Have another go, and if this is the very first visit, it needs one moment of signal to save itself for later.',
  },

  /* ------------------------------------------------------------- greetings
     Top of the Search screen, picked by the clock. The 3am one is the whole
     reason this app exists, so it gets to be the kindest. */
  greetings: [
    { id: 'morning', from: 5, to: 11, text: 'Morning, {name}' },
    { id: 'day', from: 11, to: 17, text: 'How is it going, {name}?' },
    { id: 'evening', from: 17, to: 21, text: 'Evening shift, {name}' },
    { id: 'night', from: 21, to: 5, text: '3am club. You are doing fine.' },
  ],

  searchSub: 'Type what is happening. Get a straight answer.',
  searchPlaceholder: 'green poo, wont settle, fever...',
  starterChips: [
    { emoji: '😴', label: 'wont settle', query: 'wont settle' },
    { emoji: '🍼', label: 'cluster feeding', query: 'cluster feeding' },
    { emoji: '💩', label: 'green poo', query: 'green poo' },
    { emoji: '🌡️', label: 'fever', query: 'fever' },
    { emoji: '😢', label: 'crying all evening', query: 'crying all evening' },
  ],

  search: {
    chipsLabel: 'Try one of these',
    recentsTitle: 'Recent',
    resultsNone: 'No matches',
    resultsOne: '1 match',
    resultsMany: '{n} matches',
    softLabel: 'Closest match',
    softNote: 'Not a confident match, so read it as a hint rather than an answer.',
    browseTitle: 'Or have a browse',
    browseCount: '{n} answers',
    askTitle: 'Still not it?',
    askButton: 'Ask about this',
    askNote: 'Answers come from the notes in this app, nothing else.',
    noneTitle: 'Nothing here for that one',
    noneBody: 'Which might mean we have not written it yet. If it is worrying you, ring your nurse line: that is exactly what it is for.',
  },

  /* ---------------------------------------------------------------- tiers
     The four answers. `call` is the one the app is really for, and its word
     is an instruction rather than a verdict. */
  tiers: {
    normal: { word: 'ALL NORMAL', spoken: 'all normal', label: 'Normal' },
    watch: { word: 'KEEP AN EYE', spoken: 'keep an eye on it', label: 'Keep an eye' },
    call: { word: 'CALL SOMEONE', spoken: 'call someone', label: 'Call someone' },
    depends: { word: 'DEPENDS', spoken: 'depends', label: 'Depends' },
  },

  /* ------------------------------------------------------- answer openers
     The bold few words before the why. Picked by a stable hash of the id, so
     the same question always opens the same way. Note that `call` has no
     openers at all: that sheet starts with the fact and the phone number. */
  openers: {
    normal: [
      'Completely normal.',
      'Nothing wrong here.',
      'This one is fine.',
      'Textbook, honestly.',
      'All good.',
      'Happens to nearly everyone.',
    ],
    watch: [
      'Usually fine, with one eye on it.',
      'Probably nothing, worth watching.',
      'Keep half an eye on this one.',
      'Fine for now.',
      'Worth knowing what would change this.',
    ],
    depends: [
      'Depends on which one this is:',
      'Two answers here:',
      'This one splits:',
      'Depends how it is going:',
    ],
  },

  /* ------------------------------------------------------- the answer sheet */
  answer: {
    whatToDo: 'What to do',
    whoToCall: 'Ring',
    dependsLead: 'Depends which one this is:',
    variantsHint: 'Tap a version for the detail',
    sources: 'Where this came from',
    readMore: 'Read the full page',
    checked: 'Checked {date}',
    favourite: 'Save this one',
    unfavourite: 'Remove from saved',
    howWeDecide: 'How we decide',
    unconfirmed: 'Worth ringing once in daylight to check this number still works.',
    relatedHowto: 'How to do it',
  },

  /* ----------------------------------------------------------- the week tab */
  week: {
    title: 'This week',
    noDate: 'Set the due date and this fills in',
    noDateBody: 'Everything here works off one date. Pop it in and the whole year lays itself out.',
    setDate: 'Set the date',
    expectTitle: 'What to expect',
    expectFeeds: 'Feeds',
    expectSleep: 'Sleep',
    expectTummy: 'Tummy time',
    expectNappies: 'Nappies',
    newThisWeek: 'New this week',
    focusesTitle: 'This week',
    learnTitle: 'Worth learning',
    headsUp: 'Heads up',
    stageTitle: 'Where you are up to',
    checklistTitle: 'Things to do',
    appointmentsTitle: 'Coming up',
    comingNext: 'Next',
    done: '{n} done',
    weekLabel: 'Week {week}',
    beforeLabel: 'Before bub',
  },

  /* --------------------------------------------------------- the track tab */
  track: {
    title: 'Track',
    sub: 'So neither of you has to remember.',
    feed: 'Feed',
    sleep: 'Sleep',
    nappy: 'Nappy',
    lastFeed: 'Last feed',
    lastSleep: 'Last sleep',
    todayNappies: 'Nappies today',
    never: 'Nothing logged yet',
    ago: '{n} ago',
    loggedBy: 'by {name}',
    undo: 'Undo last',
    startSleep: 'Asleep now',
    endSleep: 'Woke up',
    left: 'Left',
    right: 'Right',
    bottle: 'Bottle',
    wet: 'Wet',
    dirty: 'Dirty',
    both: 'Both',
    todayTitle: 'Today',
    emptyTitle: 'Nothing logged yet today',
    emptyBody: 'Tap a button up there when something happens. It is quicker than remembering.',
  },

  /* ---------------------------------------------------------- the buy list */
  buy: {
    title: 'The list',
    sub: 'What to get, roughly when, and what it costs.',
    categories: {
      must: 'Before day one',
      soon: 'First few weeks',
      later: 'Later on',
      maybe: 'If you feel like it',
      borrow: 'Borrow or buy used',
    },
    gotIt: 'Got it',
    totalLeft: '{n} still to get',
    estimate: 'About ${low} to ${high}',
    secondHand: 'Fine second hand',
    priceNote: 'Rough Australian prices, for planning rather than quoting.',
  },

  /* --------------------------------------------------------------- settings */
  settings: {
    title: 'Settings',
    datesTitle: 'The dates',
    dueDate: 'Due date',
    birthDate: 'Birth date',
    birthDateHint: 'Leave this blank until bub arrives, then everything switches to their real age.',
    babyName: 'What you call them',
    babyNameHint: 'Blank is fine. The app just says bub.',
    peopleTitle: 'Your people',
    peopleHint: 'Ring each one once in daylight, then tick it off. A wrong number at 2am is worse than no number.',
    confirmed: 'Checked',
    confirmNumber: 'Mark as checked',
    shareTitle: 'Both phones',
    shareHint: 'Put the same code in both phones and the list, the ticks and the tracker stay in step. Leave it empty and everything still works, just on this phone.',
    householdCode: 'Household code',
    deviceName: 'This phone is',
    syncState: 'Last synced {n} ago',
    syncNever: 'Not synced yet',
    syncPending: '{n} waiting for signal',
    syncNow: 'Sync now',
    notifyTitle: 'Nudges',
    notifyHint: 'One a week, on the day the week turns over, plus a reminder before anything that is booked. Nothing about feeds: you will not need reminding about those.',
    notifyWeekly: 'The weekly focus',
    notifyAppointments: 'Appointments coming up',
    notifyEnable: 'Turn on nudges',
    notifyBlocked: 'Your phone has notifications switched off for this app. You can turn them back on in your phone settings.',
    notifyInstall: 'Add this to your home screen first, then nudges can reach you with the app closed.',
  },

  /* ------------------------------------------------------------------- more */
  more: {
    title: 'More',
    settings: 'Settings',
    buyList: 'The list',
    cheatsheets: 'Cheat sheets',
    howtos: 'How to do things',
    ringNow: 'Ring now',
    saved: 'Saved',
    about: 'About and sources',
    howWeDecide: 'How we decide',
    disclaimer: 'General information from Australian health sources, not medical advice. Ring your nurse, GP or 000 whenever something does not feel right. You will never be told off for ringing.',
    sourcesTitle: 'Where the answers come from',
  },

  /* ---------------------------------------------------------------- the ask */
  ask: {
    title: 'Ask',
    placeholder: 'Ask in your own words...',
    send: 'Ask',
    thinking: 'Reading the notes...',
    groundedNote: 'Built only from the notes in this app. It will not guess.',
    noAnswer: 'That one is not in here. If it is worrying you, ring your nurse line, any hour.',
    errorTitle: 'That did not go through',
    errorBody: 'Have another go in a minute. The answers in Search work without signal if you need something now.',
    offline: 'No signal, so Ask is off. Search still works.',
    limit: 'That is the lot for today. Search still works, and so does the phone.',
  },

  /* ------------------------------------------------------------------- ui */
  ui: {
    tabs: TABS,
    buttons: {
      close: 'Close',
      back: 'Back',
      retry: 'Have another go',
      save: 'Save',
      cancel: 'Cancel',
      clear: 'Clear',
      call: 'Ring {label}',
      maybeLater: 'Maybe later',
      addToHome: 'Add to home screen',
    },
    install: {
      title: 'Make me an app',
      body: "Tap the Share button, then 'Add to Home Screen'. It works without signal once you do.",
    },
  },

  a11y: {
    clearSearch: 'Clear search',
    starters: 'Try one of these',
    tabsLabel: 'Bub Appetit sections',
    results: 'Search results',
  },
});
