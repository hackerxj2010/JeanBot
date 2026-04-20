## 2025-05-15 - [Vector Math Optimizations]
**Learning:** Significant performance gains were achieved in `@jeanbot/ai` by replacing high-level array methods (`reduce`, `map`, `Array.from`) with pre-allocated arrays and `for` loops. Specifically:
1. `Number(val.toFixed(8))` is extremely slow due to string conversion; `Math.round(val * 1e8) / 1e8` is ~50% faster.
2. `crypto.hash` (Node 22+) is faster for small, one-shot hashing than `crypto.createHash`.
3. Nullish coalescing (`?? 0`) and non-null assertions (`!`) in tight loops add branch overhead; using explicit type casting `(arr[index] as number)` maintains performance while satisfying Biome linting.

**Action:** Prefer `for` loops and pre-allocated arrays for math-heavy operations. Avoid string-based number formatting in performance-critical paths. Use `crypto.hash` for non-streaming hash needs.
