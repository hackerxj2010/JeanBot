## 2024-04-24 - Optimized Synthetic Vector Generation
**Learning:** Using Node 22's single-shot `crypto.hash` is significantly faster than the legacy `createHash` streaming API for small inputs. Additionally, avoiding string conversions like `.toFixed()` in tight loops by using math-based rounding provides a massive performance boost.
**Action:** Prefer `crypto.hash` for Node 22+ projects and use math-based rounding instead of `.toFixed()` for numerical precision in performance-critical paths.
