# Sentinel Security Journal

## 2026-03-12 - Advanced Redaction and Recursive Sanitization
**Vulnerability:** Simple regex-based redaction without word boundaries can lead to false positives (e.g., redacting "task-status" because it contains "sk-"). Deep objects passed to logs or telemetry might contain raw secrets if not recursively sanitized.
**Learning:** Strict word boundaries using negative lookbehind/lookahead `(?<![\w-])` and `(?![\w-])` are essential for accurate token identification.
**Prevention:** Use the new `sanitizeData` utility to process all complex objects before they leave secure boundaries, ensuring `Date` objects are cloned and secrets are recursively redacted.
