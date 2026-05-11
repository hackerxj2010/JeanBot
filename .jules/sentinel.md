## 2026-05-11 - Path Prefix and Command Boundary Bypasses
**Vulnerability:** Path traversal via prefix matching and command bypass via incorrect word boundaries.
**Learning:**
1. `path.startsWith(root)` is insufficient for directory validation as it allows sibling directories with the same prefix (e.g., `/app-secret` matches `/app`). Use `path.relative` and check for `..`.
2. Regex word boundaries (`\b`) do not work as expected when adjacent to non-word characters like `/`. `\brm -rf /\b` fails to match exactly `rm -rf /`. Use explicit shell delimiters like `[\s;&|]`.
**Prevention:** Always use `path.relative` for directory enclosure checks and use robust shell-aware delimiters for command blacklisting.
