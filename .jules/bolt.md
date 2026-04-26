
## 2025-05-14 - Optimized AI vector operations and hashing
**Learning:** Node 22+ `crypto.hash` is significantly faster than the legacy `createHash` stream-based API for one-off operations. `Math.round(val * 1e8) / 1e8` is much faster than `Number(val.toFixed(8))` in Node.js because it avoids string conversions.
**Action:** Use single-shot `crypto.hash` for all non-streaming hash needs. Prefer numeric rounding over `toFixed` in performance-critical vector math.
