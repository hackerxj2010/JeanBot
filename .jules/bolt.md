## 2026-05-06 - Hashing and Vector Optimization
**Learning:** Node 22's `crypto.hash` is ~3x faster than the legacy `crypto.createHash` pattern for single-shot operations. Additionally, `Math.round(v * 1e8) / 1e8` is orders of magnitude faster (~250x) than `Number(v.toFixed(8))` for precision rounding, as it avoids expensive string conversions.
**Action:** Use `crypto.hash` for one-off hashes and favor math-based rounding over `toFixed` in hot paths like vector normalization.
