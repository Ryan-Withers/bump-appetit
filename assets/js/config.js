// The only file you need to edit to make this app yours.
// Everything here is safe to change from a phone via github.dev.

export const CONFIG = Object.freeze({
  // Who the app greets at 3am. Whoever is holding the phone.
  name: 'Emma',

  // Bub's name, once you have picked one. Null until then, and the app just
  // says "bub", which is what you will be calling them anyway.
  babyName: null,

  // THE IMPORTANT ONE. Everything in the Week tab hangs off this: which week
  // you are in, what to expect, what to focus on, when the appointments fall.
  //
  // Before the birth it counts down. Set `birthDate` the day bub arrives and
  // the whole app switches to counting their actual age instead, which matters
  // because almost nobody arrives on their due date.
  dueDate: '2027-04-15',
  birthDate: null,

  // The date shown on every card, as "Checked {reviewedLabel}".
  // Bump it after each time you re-read the sources.
  reviewedLabel: 'Oct 2026',

  /* ------------------------------------------------------------- your people
     CONFIRM THESE BEFORE YOU NEED THEM. A wrong number at 2am is worse than no
     number, so each one below is marked with where it came from. Ring them once
     in daylight, fix anything that is off, and set `confirmed` to true. The app
     shows an unconfirmed number with a quiet "worth checking" note. */
  contacts: Object.freeze([
    Object.freeze({
      id: 'hospital',
      label: 'St Vincent\'s Private, Fitzroy',
      who: 'Maternity, 24 hours',
      number: '0394117634',
      display: '(03) 9411 7634',
      note: 'Birth suite and maternity ward. 59 Victoria Parade, Fitzroy.',
      source: 'svph.org.au maternity page',
      confirmed: false,
    }),
    Object.freeze({
      id: 'hospital-switch',
      label: 'St Vincent\'s switchboard',
      who: 'If the maternity line does not pick up',
      number: '0394117111',
      display: '(03) 9411 7111',
      note: null,
      source: 'svph.org.au',
      confirmed: false,
    }),
    Object.freeze({
      id: 'ob',
      label: 'Dr Kenneth Leong',
      who: 'Your OB, consulting rooms',
      number: '0394287572',
      display: '(03) 9428 7572',
      note: 'Business hours. After hours, ring the hospital instead.',
      source: 'Monash IVF listing',
      confirmed: false,
    }),
    Object.freeze({
      id: 'mch-line',
      label: 'Maternal & Child Health Line',
      who: 'Victoria, 24 hours, free',
      number: '132229',
      display: '13 22 29',
      note: 'Nurses, any hour, for feeding, sleep and "is this normal".',
      source: 'Victorian Government MCH Line',
      confirmed: false,
    }),
    Object.freeze({
      id: 'nurse-on-call',
      label: 'NURSE-ON-CALL',
      who: 'Victoria, 24 hours',
      number: '1300606024',
      display: '1300 60 60 24',
      note: 'Registered nurse, any health question, any hour.',
      source: 'Victorian Government',
      confirmed: false,
    }),
    // Fill these two in when you have them.
    Object.freeze({
      id: 'mch-nurse',
      label: 'Your MCH nurse',
      who: 'Your local council centre',
      number: '',
      display: '',
      note: 'Add the direct number once your first visit is booked.',
      source: null,
      confirmed: false,
    }),
    Object.freeze({
      id: 'gp',
      label: 'Your GP',
      who: 'Clinic',
      number: '',
      display: '',
      note: 'Worth adding the after-hours line too, if they have one.',
      source: null,
      confirmed: false,
    }),
  ]),

  /* ------------------------------------------------------------------- ask
     Lets Emma ask a question in her own words and get an answer built ONLY
     from the entries in this app, each one already summarised from Raising
     Children, Red Nose, the Breastfeeding Association or the RCH. It never
     searches the open web and it never answers from memory: if the app does
     not hold the answer, it says so and gives her a number instead. */
  ask: Object.freeze({
    // The deployed Cloudflare Worker URL. Leave it empty and the Ask button
    // simply does not appear, rather than failing when she taps it.
    endpoint: '',

    // Shared passphrase, sent as the x-bub-pass header. Must match the PASS
    // secret on the Worker. It ships to the browser, so treat it as public:
    // what actually caps the damage is the Worker's own daily limit.
    pass: '',

    timeoutMs: 45000,
  }),

  // "Ask Ryan to add it" on the no-results screen opens this.
  suggestUrl:
    'https://github.com/Ryan-Withers/bump-appetit/issues/new?labels=entry-request&title=Please%20add%3A%20&body=What%20I%20searched%20for%3A%0A%0AWhat%20was%20happening%3A%0A',
});
