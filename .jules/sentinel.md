## 2026-05-13 - Path Prefix and Shell Command Bypass in Terminal Service
**Vulnerability:** The TerminalService was vulnerable to path prefix bypass (e.g., `/app/workspace-secret` matching `/app/workspace`) and regex-based command blacklist bypass for `rm -rf /` due to misuse of word boundaries (`\b`).
**Learning:** `.startsWith()` string matching is insufficient for filesystem hierarchy validation. Additionally, `\b` regex markers do not reliably match boundaries involving non-word characters like `/`.
**Prevention:** Always use `path.relative` to verify directory containment. Use robust shell-aware boundary markers `(?:^|[\s;&|])` and `(?:[\s;&|]|$)` for blacklisting sensitive terminal commands.
