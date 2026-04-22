## 2026-04-22 - Accurate Secret Redaction with Hyphenated Patterns
**Vulnerability:** Incomplete or over-eager secret redaction when using standard word boundaries (`\b`) for patterns containing hyphens (e.g., `sk-ant-`).
**Learning:** Standard regex word boundaries (`\b`) treat the hyphen as a boundary. For tokens like `sk-ant-...`, `\bsk-` matches even if it's part of `not-sk-...`, and `\bsk-ant-` might fail to match as a single unit if not handled carefully.
**Prevention:** Use negative lookbehind `(?<![A-Za-z0-9_-])` and negative lookahead `(?![A-Za-z0-9_-])` instead of `\b` to accurately isolate secrets that include hyphens or underscores, ensuring they are only redacted when they are standalone tokens.
