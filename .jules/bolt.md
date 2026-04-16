## 2026-03-20 - [AI Vector Optimization]
**Learning:** Using `crypto.hash` (Node 22+) for single-shot hashing is significantly faster than the legacy `createHash().update().digest()` chain. Furthermore, avoiding string-based precision rounding (`toFixed`) in favor of mathematical rounding (`Math.round(v * 1e8) / 1e8`) eliminates costly string conversions in hot loops, resulting in a ~53% performance gain for synthetic vector generation.
**Action:** Prefer `crypto.hash` for one-off hashes and avoid string-intermediated operations (like `toFixed`) in performance-critical numerical computations.
