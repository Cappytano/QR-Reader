# QR-Reader / QR Logger — v5.3.3

Fixes:
- **SyntaxError** (`Invalid shorthand property initializer`) caused by `timestamp=iso` typo → now `timestamp: iso`.
- Added **type="button"** to all interactive buttons (prevents default form-submit behavior).
- CSS vendor order: `-webkit-backdrop-filter` now precedes `backdrop-filter`.

Notes:
- Firefox warnings about `meta[name="theme-color"]` and `playsinline` are informational. They don’t break the app.
