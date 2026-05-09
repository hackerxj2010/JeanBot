## 2026-05-09 - Hashing and Vector Optimizations
**Learning:** Node 22's `crypto.hash` is ~62% faster than `crypto.createHash` for single-shot operations by avoiding object overhead. Additionally, `Math.round(v * 1e8) / 1e8` is ~30x faster than `toFixed(8)` as it avoids expensive number-to-string conversions. Manual `for` loops also outperform `Array.from` and `.reduce` by ~94% for high-dimensional vectors (e.g., 1536d).
**Action:** Use `crypto.hash` for one-shot hashes and prefer math-based precision over `toFixed` in hot paths. Use manual loops for heavy numeric processing.
