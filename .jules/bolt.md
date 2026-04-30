## 2025-04-30 - AI Vector & Hash Optimization
**Learning:** Node.js 22's `crypto.hash` provides a significant performance boost for one-shot hashing compared to `crypto.createHash`. Replacing `Array.from` and `toFixed(8)` with pre-allocated arrays and `Math.round` precision math yields ~17% speedup in synthetic vector generation.
**Action:** Use single-shot `crypto.hash` for small inputs and avoid string-converting rounding methods in tight numerical loops. Always include a runtime check for `crypto.hash` to maintain compatibility with older Node.js versions.
