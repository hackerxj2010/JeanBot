## 2026-04-20 - AI Package Vector Optimizations
**Learning:** Significant performance gains can be achieved in AI vector operations by avoiding high-level array methods (Array.from, map, reduce) in tight loops and replacing expensive string-based rounding (toFixed) with mathematical rounding. In Node 22+, `crypto.hash` is also notably faster than `crypto.createHash` for single-shot hashing.
**Action:** Use simple `for` loops and pre-allocated arrays for vector math. Use `Math.round(x * 1e8) / 1e8` for 8-decimal precision. Prefer `crypto.hash` when working with recent Node.js versions.
