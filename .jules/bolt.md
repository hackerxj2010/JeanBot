# Bolt Performance Journal

## 2025-05-15 - [Synthetic Embedding Optimization]
**Learning:** Replaced `toFixed(8)` with mathematical rounding `Math.sign(x) * Math.round(Math.abs(x) * 1e8) / 1e8`. String-based rounding (`toFixed`) is a major bottleneck in high-dimensional vector operations (e.g., 1536 iterations). Combined with Node 22's `crypto.hash` and manual `for` loops, performance improved by ~47%.
**Action:** Always prefer mathematical rounding over `toFixed` for performance-critical numerical paths. Use manual `for` loops and pre-allocated arrays for high-iteration vector math.
