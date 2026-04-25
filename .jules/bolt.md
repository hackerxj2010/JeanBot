## 2025-05-15 - [Node 22 crypto.hash and Vector Optimization]
**Learning:** Node 22's `crypto.hash` defaults to returning a hex string, but returns a Buffer if "buffer" is passed as the third argument. Omitting the encoding can break code expecting a specific type. Additionally, `Number(val.toFixed(8))` is extremely slow in tight loops due to string serialization; `Math.round(val * 1e8) / 1e8` is ~40x faster.
**Action:** Always specify the desired encoding for `crypto.hash` to avoid breaking changes. Use direct math for rounding in performance-critical loops.
