## 2026-05-18 - [Vector math and Hashing Optimizations]
**Learning:** Replaced `toFixed(8)` with `Math.round(n * 1e8) / 1e8` for 100x faster rounding. Pre-allocated arrays and used manual `for` loops in high-dimensional vector operations (1536 dims) to avoid `reduce`/`map` overhead. Node 22's `crypto.hash` provides ~60% faster single-shot hashing than `createHash` chain.
**Action:** Always favor manual loops and pre-allocated arrays for vector math. Use `crypto.hash` with defensive fallbacks and explicit "buffer" encoding when calling Buffer methods like `readUInt32BE`.
