## 2025-05-09 - Synthetic Vector Optimization
**Learning:** Significant performance gains (~54%) in vector operations can be achieved in Node 22 by replacing `toFixed(8)` with `Math.round(val * 1e8) / 1e8`, using `crypto.hash` for single-shot hashing, and preferring manual `for` loops with pre-allocated arrays over functional methods like `Array.from` or `map` for high-dimensional data (1536d).
**Action:** Always prefer `crypto.hash` over `createHash` for single-shot operations in Node 22+, and avoid string-converting math operations like `toFixed` in hot loops.
