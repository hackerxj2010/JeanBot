## 2026-05-12 - Memoization vs. API Optimization
**Learning:** While Node 22's `crypto.hash` provides a ~60% speedup for single-shot hashing, memoizing the result of expensive operations (like deriving an encryption key from a static secret) provides a >99% improvement (4432ms -> 13ms in benchmarks).
**Action:** Always check if a computed value is static or can be cached before reaching for micro-optimizations of the computation itself.

## 2026-05-12 - Node 22 crypto.hash Compatibility
**Learning:** Node 22's `crypto.hash` is significantly faster than the legacy `createHash` chain but requires `@ts-ignore` in TypeScript until project definitions are updated.
**Action:** Use `crypto.hash` for one-shot operations in performance-critical paths (e.g., AI/Security) but ensure Node 22+ environment via `package.json` engines.
