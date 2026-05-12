## 2026-05-12 - [Timing safe internal token validation]
**Vulnerability:** Timing attack vulnerability in internal service token validation.
**Learning:** Using simple string equality (`!==`) for sensitive token validation can leak information about the token through timing differences in the comparison.
**Prevention:** Always use `crypto.timingSafeEqual` with fixed-length hashes (like SHA-256) for validating security-sensitive tokens and headers.
