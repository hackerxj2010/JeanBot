# Sentinel's Security Journal

## 2026-05-08 - Regex Word Boundary Bypass with Non-Word Characters
**Vulnerability:** The terminal guardrail `\brm\s+-rf\s+\/\b` failed to block `rm -rf /` because `/` is a non-word character. In most regex engines, `\b` matches the position between a word character (`[a-zA-Z0-9_]`) and a non-word character. Since `/` is already a non-word character, `/\b` at the end of a string fails to match.
**Learning:** Never use `\b` for boundaries involving non-word characters like slashes, dots, or dashes in security-critical regexes. It can lead to bypasses for the very patterns intended to be blocked.
**Prevention:** Use robust boundary patterns like `(?:^|[\s;&|])` for prefix and `(?:[\s;&|]|$)` for suffix when matching shell commands or paths to ensure correct isolation regardless of special characters.
