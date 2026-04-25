## 2026-04-25 - Enhanced Secret Redaction and Recursive Sanitization
**Vulnerability:** Potential leakage of sensitive API keys (Anthropic, JeanBot) in terminal output previews and audit logs due to incomplete redaction patterns and lack of recursive data scrubbing.
**Learning:** Simple string replacement is insufficient for complex data structures like audit logs. Recursive sanitization is necessary to ensure defense-in-depth across the microservices.
**Prevention:** Use the `sanitizeData` utility from `@jeanbot/security` for all logging and preview generation, and ensure `redactSecrets` uses strict word boundaries to avoid false positives.
