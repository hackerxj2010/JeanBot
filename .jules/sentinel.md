## 2026-04-26 - Enhanced Secret Redaction and Sanitization

**Vulnerability:** Core redaction patterns were missing several major AI and platform providers (Anthropic, Stripe, GitHub, JeanBot), and there was no utility for recursive data sanitization in nested objects or arrays.

**Learning:** Regex patterns for secrets need strict word boundaries `(?<![\w-])` and `(?![\w-])` to prevent false positives and ensure accurate labeling. Redaction should be ordered from most specific to least specific.

**Prevention:** Use the new `sanitizeData` utility to recursively redact secrets from all logs and audit events. Maintain a comprehensive list of provider-specific regex patterns with strict boundary enforcement.
