## 2025-05-16 - [Terminal Service Path and Command Bypass]
**Vulnerability:** Path validation using `.startsWith()` allowed prefix bypasses (e.g., 'workspace-secret' vs 'workspace'), and command guardrails used `\b` which fails on non-word characters like '/'.
**Learning:** Standard regex word boundaries (`\b`) are unreliable for shell command guardrails when patterns end in non-word characters. Path containment should always use `path.relative` to verify actual directory structure.
**Prevention:** Use robust boundary checks like `(?:^|[\s;&|])` and `(?:[\s;&|]|$)` for command patterns, and `path.relative(root, target).startsWith('..')` for path containment.
