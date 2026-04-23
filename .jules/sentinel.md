## 2026-04-23 - Strengthening Terminal Security and Data Privacy
**Vulnerability:** Terminal service lacked sufficient command filtering (allowing piping to shell and access to sensitive system files) and leaked secrets in output previews and audit logs.
**Learning:** The initial implementation relied on a narrow set of blocked patterns and didn't account for recursive data structures in audit logs, leading to both command injection risks and potential secret leakage.
**Prevention:** Use comprehensive regex patterns for command filtering and integrate a centralized sanitization utility (`sanitizeData`) that recursively redacts secrets while preserving complex data types like `Date` objects.
