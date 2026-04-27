# Bolt Performance Journal

## 2026-03-12 - AI Utility Optimization
**Learning:** Functional patterns like `map`, `reduce`, and `Array.from` introduce significant overhead in performance-critical paths such as vector normalization and synthetic embedding generation. Node 22's single-shot `crypto.hash` is notably faster than the `createHash` stream API for small inputs.
**Action:** Replace tight loops with standard `for` loops and pre-allocated arrays. Use `Math.round(val * 1e8) / 1e8` for fast precision rounding instead of string-based `toFixed`.
