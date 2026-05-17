## 2026-05-17 - [Path Traversal & Command Bypass in Terminal Service]
**Vulnerability:** Path traversal via prefix bypass and command injection guardrail bypass using shell delimiters.
**Learning:** `startsWith` is insufficient for path validation if the root is a prefix of an unauthorized directory. Standard regex word boundaries (\b) are unreliable for shell command guardrails when patterns end in non-word characters like '/'; they fail to block sequences like `rm -rf / ;`.
**Prevention:** Use `path.relative` logic to verify directory containment. Use explicit boundary checks like `(?:^|[\s;&|])` and `(?:[\s;&|]|$)` for shell command filtering.
