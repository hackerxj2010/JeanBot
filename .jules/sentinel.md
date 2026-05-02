## 2026-05-02 - Flawed Regex Boundary in Terminal Command Blacklist
**Vulnerability:** The command `rm -rf /` was not correctly blocked by the security middleware.
**Learning:** The regex used `/\brm\s+-rf\s+\/\b/i`. In many regex engines (including JavaScript's), `\b` is a boundary between a word character (`\w`) and a non-word character. Since `/` is already a non-word character, a trailing `\b` requires the *next* character to be a word character. If the command ends in `/` or is followed by a space, the boundary condition is not met, and the match fails.
**Prevention:** Avoid using trailing `\b` word boundaries for patterns that end in non-word characters (like `/`, `.`, or `|`). Instead, use `(\s|$)` or simply omit the boundary if the suffix is unique enough.
