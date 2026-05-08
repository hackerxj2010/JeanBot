## 2026-05-08 - Optimized Vector Operations in AI Package
**Learning:** In Node 22, `crypto.hash` is significantly faster (~31%) than `crypto.createHash` for single-shot hashing. For large-dimensional vectors (e.g., 1536), manual `for` loops are ~28x faster than `Array.from` and `Math.round(v * 1e8) / 1e8` is ~30x faster than `toFixed(8)` by avoiding string conversions.
**Action:** Always prefer manual loops and `Math.round` for hot path vector operations. Use `crypto.hash` for one-off hashing in Node 22+.
