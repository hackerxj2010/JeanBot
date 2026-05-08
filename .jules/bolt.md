## 2026-05-08 - Optimized Synthetic Embedding Generation
**Learning:** Node 22's `crypto.hash` is significantly faster than `crypto.createHash` for single-shot hashing. Additionally, manual `for` loops and `Math.round` for precision are much more efficient than `Array.from`, `.map`, and `.toFixed` when dealing with high-dimensional vectors (e.g., 1536d).
**Action:** Use Node 22's native `crypto.hash` with `buffer` encoding for performance-critical hashing, and prefer manual `for` loops over high-level array methods in hot paths like vector normalization.
