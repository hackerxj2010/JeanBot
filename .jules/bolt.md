## 2026-04-23 - [Optimization of Synthetic Embedding Generation]
**Learning:** Significant performance gains in vector operations and hashing can be achieved in Node 22+ by using single-shot `crypto.hash()`, avoiding string-based rounding (like `toFixed`), and replacing high-level array methods with traditional `for` loops in hot paths.
**Action:** Use `crypto.hash(alg, data, output)` for one-off hashes. Use `Math.round(val * 1e8) / 1e8` for fixed-precision rounding. Pre-calculate constants (like `1/magnitude`) to use multiplication instead of division in loops.
