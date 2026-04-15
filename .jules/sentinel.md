## 2026-04-15 - [Enhance Secret Redaction Patterns]
**Vulnerability:** Limited secret redaction patterns in the security package. Previously, only generic OpenAI, Google, and Bearer tokens were redacted.
**Learning:** Generic regex patterns like `/sk-/` can incorrectly label specific keys (e.g., Anthropic keys being labeled as OpenAI keys) and may cause false positives in normal text if word boundaries are missing.
**Prevention:** Use specific regex patterns with word boundaries (`\b`) and order them from most specific to least specific to ensure accurate redaction and labeling.
