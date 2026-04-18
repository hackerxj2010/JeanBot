## 2026-04-18 - [Optimized Synthetic Embeddings and Vector Operations]
**Learning:** Significant performance gains in Node.js hot paths (loops, math) can be achieved by:
1. Replacing `toFixed()` (which involves string conversion) with `Math.round(x * 1eN) / 1eN`.
2. Using `crypto.hash()` (Node 22+) for single-shot hashing instead of the `createHash` stream API.
3. Avoiding nullish coalescing (`??`) and other branch-heavy operations inside tight loops.
4. Replacing functional patterns (`map`, `reduce`, `Array.from`) with pre-allocated arrays and standard `for` loops.
**Action:** Always prefer pre-allocated arrays and `for` loops for vector operations (1000+ elements). Use `crypto.hash` when target environment is Node 22+.
