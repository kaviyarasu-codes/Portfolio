# Impeccable anti-pattern detector (vendored, unmodified)

- Project: https://github.com/pbakaus/impeccable (https://impeccable.style) by Paul Bakaus
- Licence: Apache License 2.0 (see LICENSE and NOTICE.md in this folder)
- Version: 4.10.0, commit b49177d32788f2dc585c42831d845dacf1ebed2c
- Files: `crates/live/assets/detect-antipatterns-browser.js` and `antipatterns.json`, copied as-is.

Used by the Site Audit real-browser design check (`functions/_lib/visual.js`): the page loads
this script with `autoScan: false` and calls `window.impeccableDetectAsync()`.

Update: copy the same two files from a newer Impeccable checkout and change the version above.
