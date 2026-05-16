# Bolt's Performance Journal

## 2025-05-14 - [Initial Benchmarks]
**Learning:** Node 22's `crypto.hash` is significantly faster (~3.4x) than the legacy `crypto.createHash().update().digest()` for single-shot operations. Additionally, `Number(v.toFixed(8))` is extremely slow compared to `Math.round(v * 1e8) / 1e8` (~120x difference). Manual `for` loops with pre-allocated arrays are also much faster (~4.7x) than `.map` or `Array.from` for high-dimensional vectors (e.g., 1536 dimensions).
**Action:** Prefer `crypto.hash` in Node 22+. Use `Math.round` for precision control in performance-critical paths. Use manual loops for large vector operations.
