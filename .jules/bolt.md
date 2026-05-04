## 2026-05-04 - Vector operation and hashing optimization
**Learning:** High-performance vector operations (normalization, synthetic generation) in Node.js benefit significantly from manual for-loops over functional patterns (map/reduce) and math-based precision rounding over string-based (.toFixed).
**Action:** Use standard for-loops and Math.round-based precision for performance-critical math/vector paths. Use Node 22's crypto.hash for one-shot hashing.
