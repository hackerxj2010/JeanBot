## 2026-05-10 - Timing attack vulnerability in internal token validation
**Vulnerability:** Internal service requests were validated using standard string comparison (headers["x-jeanbot-internal-token"] !== token), which is vulnerable to timing attacks.
**Learning:** Even internal-only tokens should be compared using timing-safe functions to prevent side-channel information leakage about the token's content.
**Prevention:** Always use `crypto.timingSafeEqual` for sensitive string comparisons. When strings have different lengths, hash them first with a fixed-length algorithm like SHA-256 before the timing-safe comparison.
