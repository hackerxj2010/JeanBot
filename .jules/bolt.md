## 2026-05-01 - AI Vector Operation Optimization
**Learning:** High-overhead functional patterns (`map`, `reduce`) in large vector operations significantly impact performance. Fixed-precision math with `toFixed` is slower than `Math.round` due to string conversion. Node 22's `crypto.hash` is faster than `createHash`.
**Action:** Use `for` loops for performance-critical vector math. Replace `toFixed(8)` with `Math.round(val * 1e8) / 1e8`. Use Node 22 native hashing when available.
