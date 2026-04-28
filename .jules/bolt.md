## 2024-04-28 - Optimizing AI Utilities with Node 22 APIs
**Learning:** Replacing `toFixed(n)` with `Math.round(val * 1e{n}) / 1e{n}` in performance-critical loops provides a massive speedup (up to 50% for synthetic embeddings) because it avoids expensive number-to-string-to-number conversions. Also, using Node 22's `crypto.hash` for single-shot hashing is significantly faster than creating a hash object, updating it, and then digesting it.
**Action:** Always prefer math-based precision limiting in tight loops and use `crypto.hash` (with appropriate feature detection) for single-shot hashing.
