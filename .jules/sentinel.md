## 2026-05-06 - Terminal Command Guardrail Bypass
**Vulnerability:** The regex `/\brm\s+-rf\s+\/\b/i` failed to block `rm -rf /` because `\b` (word boundary) does not match the transition between `/` (non-word character) and a space or end-of-line.
**Learning:** Standard word boundaries `\b` are unreliable for patterns ending in non-word characters like slashes.
**Prevention:** Use explicit character classes or anchors like `(?:\s|;|$)` instead of `\b` when a pattern ends with a non-word character.
