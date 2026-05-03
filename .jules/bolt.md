## 2026-05-03 - Optimize synthetic embedding generation
**Learning:** Math.round-based precision (e.g., Math.round(val * 1e8) / 1e8) is ~30x faster than Number(val.toFixed(8)) because it avoids expensive string serialization/parsing. Node 22's crypto.hash is also significantly faster for one-off hashes.
**Action:** Use mathematical rounding for fixed-precision needs in performance-critical paths. Use crypto.hash in Node 22+ environments for better performance.
