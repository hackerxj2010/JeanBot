## 2026-04-29 - AI Performance Optimizations
**Learning:** Replaced expensive `.toFixed(8)` calls with fast `Math.round(val * 1e8) / 1e8` arithmetic. Node 22's single-shot `crypto.hash` is ~60% faster than stream-based `createHash`.
**Action:** Use fast rounding and single-shot hashing in performance-critical mathematical and hashing paths.
