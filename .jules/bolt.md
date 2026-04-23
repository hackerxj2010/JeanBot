## 2026-04-23 - [AI Package Vector Optimization]
**Learning:** Significant performance gains can be achieved in Node 22+ by moving away from higher-level abstractions like `Array.from` and `.reduce` in math-heavy loops, and utilizing single-shot `crypto.hash`. Rounding via `Math.round(x * 1e8) / 1e8` is also much faster than `toFixed(8)`.
**Action:** Prioritize `for` loops and pre-allocated arrays for vector operations. Use `crypto.hash` instead of `createHash` streams for small inputs. Avoid string conversions in tight loops.

## 2026-04-23 - [Robustness vs. Micro-optimization]
**Learning:** Removing nullish coalescing (`?? 0`) in exported utilities like `cosineSimilarity` can cause `NaN` if inputs are sparse. While it provides a speedup, it breaks the "no breaking changes" rule if the utility's contract allows sparse arrays.
**Action:** Keep safety checks in public/exported utilities unless inputs are guaranteed to be dense. Balance speed with correctness.
