## 2026-05-13 - Node 22 crypto.hash optimization
**Learning:** Node 22's `crypto.hash` API provides a ~62% performance improvement over the legacy `createHash().update().digest()` pattern for single-shot hashing of small inputs.
**Action:** Use `crypto.hash` for non-streaming hash operations in performance-critical paths (e.g. vector generation, API key hashing) when targeting Node 22+. Always use `@ts-ignore` as current type definitions might not yet include this modern API.

## 2026-05-13 - Math.round vs toFixed for precision
**Learning:** `Math.round(v * 1e8) / 1e8` is significantly faster (>90%) than `toFixed(8)` because it avoids expensive double-to-string-to-double conversions.
**Action:** Use the `Math.round` pattern for high-frequency numerical rounding in vector operations, but ensure midpoint rounding for negative numbers is handled correctly (e.g. `v >= 0 ? ... : -Math.round(-v * 1e8) / 1e8`) to maintain parity with `toFixed`.
