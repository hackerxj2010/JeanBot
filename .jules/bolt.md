## 2025-05-14 - Node 22 single-shot `crypto.hash` API
**Learning:** Node.js 22's `crypto.hash(algorithm, data, [outputEncoding])` returns a hex string by default. To get a `Buffer` (necessary for binary operations like `.readUInt32BE()`), the `outputEncoding` must be explicitly set to `'buffer'`. Inconsistent return types between the new single-shot API and legacy `crypto.createHash().digest()` can lead to subtle bugs, especially when the hash is used as a seed in string templates.

**Action:** Always specify the desired `outputEncoding` when using `crypto.hash` to ensure consistent behavior across Node versions and prevent return type mismatches. Use `'hex'` for content identifiers and `'buffer'` for binary processing.
