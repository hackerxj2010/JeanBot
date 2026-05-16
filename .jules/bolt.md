# BOLT'S JOURNAL - CRITICAL LEARNINGS ONLY

## 2026-05-16 - [Vector Operation Optimizations]
**Learning:** Significant performance gains can be achieved in high-dimensional vector operations by avoiding high-level JS abstractions. Specifically:
1. `toFixed(8)` is extremely slow (orders of magnitude) compared to `Math.round(v * 1e8) / 1e8` because it involves string serialization.
2. `Array.from` and `.map`/`.reduce` on large arrays (e.g., 1536 dims) are much slower than pre-allocating with `new Array(len)` and using manual `for` loops.
3. Node 22's `crypto.hash` is ~70% faster than the legacy `createHash().update().digest()` pattern for single-shot operations.

**Action:** Prefer manual loops and `Math.round` for performance-critical numeric processing. Use Node 22's `crypto.hash` for hashing strings or buffers in one go.
