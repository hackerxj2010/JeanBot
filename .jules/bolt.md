## 2026-05-11 - Modernizing Vector and Hashing Ops
**Learning:** Node 22's `crypto.hash` is ~2x faster than legacy `createHash` for one-shot operations. Mathematical precision using `Math.round(v * 1e8) / 1e8` is ~30x faster than `toFixed(8)` because it avoids string conversions. Manual `for` loops beat `Array.from` by ~28x for large vector dimensions (1536).
**Action:** Always prefer Node 22 high-performance APIs and avoid string conversion in tight mathematical loops.
