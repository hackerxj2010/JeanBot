## 2026-05-07 - Optimize vector generation and hashing in @jeanbot/ai
**Learning:** Node 22's `crypto.hash` is ~31% faster than legacy `createHash` for single-shot operations. Manual `for` loops and `Math.round`-based precision are significantly faster (~28x-30x) than `Array.from`, `.reduce`, `.map`, and `toFixed(8)` for high-dimensional vector operations.
**Action:** Always prefer manual loops and primitive math for performance-critical vector math. Use Node 22's `crypto.hash` when available, but remember to omit the encoding argument to get a `Uint8Array`/`Buffer` or use 'hex' for strings.
