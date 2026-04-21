## 2026-04-21 - Secret Leakage in Logs and Previews
**Vulnerability:** API keys and tokens were being exposed in terminal output previews and audit log details.
**Learning:** Even if the core system doesn't store secrets, they can leak through secondary channels like truncated previews or "debug" fields in audit events. Generic redaction patterns without word boundaries also lead to false positives (redacting `not-sk-123`).
**Prevention:** Implement recursive sanitization for all data passed to logging or display services. Use negative lookbehind/lookahead in redaction regex to enforce strict word boundaries.
