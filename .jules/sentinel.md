## 2026-05-01 - Security Redaction and Terminal Hardening
**Vulnerability:** Core services could leak provider keys (Anthropic, Stripe, GitHub) and allow dangerous shell patterns (script piping, sensitive file access).
**Learning:** Generic regex patterns for secrets often miss specific formats or have loose boundaries. Terminal safety requires blocking more than just destructive commands; it must also block data exfiltration patterns.
**Prevention:** Use specific regexes with strict word boundaries. Centralize recursive sanitization. Maintain a robust blocklist for terminal execution that includes redirection and piping to interpreters.
