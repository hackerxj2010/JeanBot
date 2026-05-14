## 2026-05-14 - Robust Path Validation and Command Blacklisting in Terminal Service
**Vulnerability:** The `TerminalService` was vulnerable to path prefix bypasses in `resolveCwd` (e.g., `/app/workspace-secret` being allowed if `/app/workspace` was allowed) and command blacklist bypasses due to incorrect use of regex word boundaries (`\b`) with non-word characters like `/`.

**Learning:** `path.startsWith()` is insufficient for directory validation as it doesn't account for path separators, allowing sibling directories with matching prefixes. Additionally, regex `\b` does not match between a word character and a non-word character like `/` if the non-word character is at the start or end of the string, or next to other non-word characters.

**Prevention:** Always use `path.relative()` and check for `..` to validate directory containment. For command blacklisting of paths or special characters, use explicit shell separators `(?:^|[\s;&|])` and `(?:[\s;&|]|$)` instead of `\b`.
