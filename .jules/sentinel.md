## 2026-04-30 - [Regex Word Boundary Bypass in Terminal Safeguards]
**Vulnerability:** The regex pattern `/\brm\s+-rf\s+\/\b/i` intended to block root directory deletion failed because the trailing `\b` (word boundary) does not match after a `/` (non-word character) unless it's followed by a word character.
**Learning:** Standard regex word boundaries (`\b`) behave unexpectedly when adjacent to non-word characters like `/`.
**Prevention:** Avoid using `\b` at the end of regex patterns that terminate in non-word characters. Use explicit character classes or lookarounds if specific boundaries are needed.
