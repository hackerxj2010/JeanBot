## 2026-04-22 - [Optimizing Vector Operations in @jeanbot/ai]
**Learning:** Significant performance gains can be achieved in hot paths by avoiding string conversions (e.g., `toFixed`) and using Node 22+ native `crypto.hash`. Replacing `.map()` and `.reduce()` with `for` loops and pre-calculating inverse magnitudes also yielded measurable speedups.
**Action:** Always prefer mathematical rounding over string-based formatting in performance-critical loops. Use single-shot `crypto.hash` for small inputs in Node 22+.
