# Bolt's Performance Journal

## 2025-05-15 - AI Embedding Optimizations
**Learning:** Synthetic embedding generation is bottlenecked by string-based rounding (`toFixed(8)`) and streaming hash creation (`createHash`).
**Action:** Use math-based rounding (`Math.round(x * 1e8) / 1e8`) and single-shot `crypto.hash` for massive performance gains in tight loops.

## 2025-05-15 - Node 22 crypto.hash output encoding
**Learning:** In Node 22, `crypto.hash(alg, data, "buffer")` is a valid way to get a Buffer output, but some environments might be sensitive to it.
**Action:** Use `"buffer"` explicitly when binary operations like `readUInt32BE` are needed, as the default is a string.
