## 2026-05-19 - Robust Shell Command Guardrails and Path Validation
**Vulnerability:** Flawed regex for blocking `rm -rf /` using word boundaries (`\b`) and a prefix-based CWD validation.
**Learning:** Standard regex word boundaries (\b) do not correctly handle non-word characters like `/` at the end of a pattern (e.g., `/\brm -rf \/\b/` fails on `rm -rf /; ls`). Additionally, `startsWith` is insufficient for path validation as it allows prefix bypasses (e.g., `workspace-secret` passes when `workspace` is the allowed root).
**Prevention:** Use robust boundary checks `(?:^|[\s;&|])` and `(?:[\s;&|]|$)` for shell command patterns. For path validation, use `!path.relative(root, target).startsWith('..')` to ensure the target is actually contained within the root.
