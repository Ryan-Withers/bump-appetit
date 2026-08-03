// The only file you need to edit to make this app yours.
// Everything here is safe to change from a phone via github.dev.

export const CONFIG = Object.freeze({
  // Who the app greets. Used in the time-aware greeting on the Search screen.
  name: 'Emma',

  // The date shown on every verdict card, as "Checked {reviewedLabel}".
  // Bump this after each quarterly source re-check, and bump the "reviewed"
  // field on the entries you actually re-checked in data/foods.json.
  reviewedLabel: 'Jul 2026',

  // "Ask Ryan to add it" on the no-results screen opens this.
  // A pre-filled GitHub issue, so a request lands as a to-do list item.
  suggestUrl:
    'https://github.com/Ryan-Withers/bump-appetit/issues/new?labels=food-request&title=Please%20add%3A%20&body=Food%20I%20searched%20for%3A%0A%0AWhere%20I%20saw%20it%3A%0A',

  scanner: Object.freeze({
    // Your deployed Cloudflare Worker URL, for example
    // 'https://bump-scan.your-subdomain.workers.dev'.
    // Leave it empty and the Scan screen politely offers basic on-device
    // reading instead of pretending the smart scanner exists.
    endpoint: '',

    // Shared passphrase, sent as the x-bump-pass header. Must match the PASS
    // secret set on the Worker. This is not a security boundary, it just stops
    // a stranger who finds the URL from burning the daily quota.
    pass: '',

    // How long to wait before giving up on a scan, in milliseconds. Keep this
    // above the Worker's own model timeout, so a slow scan comes back as a
    // proper answer rather than the phone quietly giving up first.
    timeoutMs: 30000,

    // Longest edge of the uploaded photo, in pixels. Big enough for menu text,
    // small enough for cafe wifi.
    maxEdgePx: 1280,
    jpegQuality: 0.8,
  }),

  helplines: Object.freeze([
    { name: 'Pregnancy, Birth & Baby', number: '1800882436', display: '1800 882 436' },
    { name: 'NURSE-ON-CALL (Vic)', number: '1300606024', display: '1300 60 60 24' },
  ]),
});
