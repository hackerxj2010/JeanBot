## 2025-05-03 - Fixed terminal guardrail bypass for root directory
**Vulnerability:** The regex `/\brm\s+-rf\s+\/\b/i` failed to match `rm -rf /` because `/` is a non-word character and does not trigger a word boundary `\b` at the end of the string or before a space.
**Learning:** Trailing word boundaries `\b` should not be used in security regexes when the pattern ends with a non-word character like `/`, `.`, or `-`.
**Prevention:** Always verify security regexes with edge cases, especially for patterns ending in special characters. Added `tests/unit/terminal-security.test.ts` to prevent regression.

## 2025-05-03 - Improved secret redaction ordering
**Vulnerability:** Anthropic keys (`sk-ant-...`) were being redacted as generic OpenAI keys (`sk-...`) because the OpenAI pattern was matching the prefix of Anthropic keys.
**Learning:** When using regex-based redaction, more specific patterns (longer prefixes or unique identifiers) must be placed before more generic patterns to ensure correct classification and labeling.
**Prevention:** Order redaction patterns from most specific to least specific.
