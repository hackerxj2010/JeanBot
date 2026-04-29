## 2026-04-29 - Vector Operation Optimization
**Learning:** `Number(val.toFixed(8))` is a major performance bottleneck in vector operations because it involves multiple string conversions. Mathematical rounding is significantly faster. Also, `Array.from` and functional patterns (`map`, `reduce`) have higher overhead compared to pre-allocated arrays and `for` loops in hot paths like synthetic embedding generation.
**Action:** Use `Math.round(val * 1e8) / 1e8` for fixed-precision rounding and prioritize `for` loops with pre-allocated arrays for large vector processing.
