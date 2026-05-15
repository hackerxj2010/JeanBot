## 2026-05-15 - Memoized Hashing with Node 22 crypto.hash
**Learning:** Derived keys (like encryption keys from env vars) should be memoized at the module level to avoid redundant O(N) hashing operations. Node 22's `crypto.hash` provides a ~35% speed boost over the legacy stream-based `createHash` for single-shot operations.
**Action:** Always check if a hashing operation is on a static/rarely-changing input and apply module-level memoization. Use `crypto.hash` for Node 22+ environments.
