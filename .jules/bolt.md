## 2026-05-05 - Synthetic Vector Optimization
**Learning:** `Number(value.toFixed(8))` is a major performance bottleneck in vector operations due to repeated string conversions. Native `crypto.hash` (Node 22) is significantly faster than `createHash` streams for small inputs. `Array.from({length}, ...)` is slower than a manual `for` loop for large arrays like 1536-dim vectors.
**Action:** Always prefer `Math.round(val * 1e8) / 1e8` for fixed precision in hot loops. Use one-shot `crypto.hash` when available. Use pre-allocated arrays and manual loops for performance-critical vector math.
