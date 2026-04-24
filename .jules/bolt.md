## 2026-04-24 - Node 22 Crypto and Math Optimization
**Learning:** Node 22's single-shot `crypto.hash()` is significantly faster than the legacy `createHash().update().digest()` stream-based API for small inputs. Additionally, `Math.round(val * 1e8) / 1e8` is approximately 60% faster than `Number(val.toFixed(8))` in tight loops because it avoids expensive string conversions.
**Action:** Use `crypto.hash()` for one-off hashing in Node 22+ environments and prefer math-based rounding over `.toFixed()` in performance-critical paths.
