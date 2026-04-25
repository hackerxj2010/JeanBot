## 2026-04-25 - AI Vector Optimization
**Learning:** Replacing `.toFixed(8)` and `Array.from` with `Math.round` and `for` loops in vector normalization leads to significant performance gains (~60%) by avoiding string conversion and reduce/map overhead.
**Action:** Use typed arrays or pre-allocated `new Array(n)` with `for` loops for all performance-critical math operations.

## 2026-04-25 - Single-shot Hashing
**Learning:** Node 22's `crypto.hash` is significantly faster than the legacy `createHash().update().digest()` pattern for single-shot content hashing.
**Action:** Prefer `crypto.hash` for non-streaming hash requirements in Node.js 22+.
