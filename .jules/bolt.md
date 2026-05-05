# Bolt's Performance Journal

## 2025-05-14 - Optimized Hashing and Math Precision
**Learning:** Node.js 22's `crypto.hash` is significantly faster (~40% in benchmarks) than the legacy `crypto.createHash().update().digest()` for single-shot hashing. Additionally, using `Math.round(val * 1e8) / 1e8` for fixed-precision rounding is nearly 20x faster than `Number(val.toFixed(8))` as it avoids expensive string conversions.
**Action:** Prefer `crypto.hash` for single-shot operations and math-based rounding for performance-critical vector operations.
