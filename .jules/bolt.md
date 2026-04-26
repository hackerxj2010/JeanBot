## 2026-04-26 - Optimized AI Math Utilities

**Learning:** Replacing functional patterns like `.map` and `.reduce` with explicit `for` loops in performance-critical sections (like vector normalization and cosine similarity) yields significant performance gains. Pre-allocating arrays and avoiding string conversions (like `.toFixed(8)`) by using `Math.round(val * 1e8) / 1e8` further reduces execution time and garbage collection pressure.

**Action:** Always prefer optimized `for` loops and explicit type casting in tight mathematical loops. Avoid string formatting for rounding in high-frequency operations. Use Node 22's single-shot `crypto.hash` for faster hashing.
