## 2026-05-15 - Terminal Service Guardrail Bypasses
**Vulnerability:** The `TerminalService` had two significant security bypasses:
1. `assertSafeCommand` used `\b` (word boundary) in its regexes. Since `/` is a non-word character, `\brm\s+-rf\s+\/\b` failed to match `rm -rf /`, allowing critical command execution.
2. `resolveCwd` used `.startsWith(allowedRoot)` to validate the current working directory. This allowed a prefix bypass where a directory like `workspace-secret` would be accepted if `workspace` was the allowed root.

**Learning:**
- Standard regex word boundaries (`\b`) are unreliable when the pattern ends with a non-word character (like `/`).
- String-based prefix matching for file paths is dangerous due to potential partial name overlaps.

**Prevention:**
- Use robust boundary checks for shell command sanitization: `(?:^|[\s;&|])` for start and `(?:[\s;&|]|$)` for end.
- Use `path.relative(root, target)` and check if the result starts with `..` or is absolute to reliably verify path containment.
