## 2026-05-15 - [Node 22 crypto.hash and High Performance Rounding]
**Learning:** Node 22's `crypto.hash` is ~50% faster than `createHash` for single-shot operations. Manual rounding with `Math.round` is significantly faster (~300x) than `Number(v.toFixed(n))`.
**Action:** Use `crypto.hash` for non-streaming hashes in Node 22+ environments. Prefer `Math.round` based precision logic over `toFixed` in performance-critical paths like vector normalization.
