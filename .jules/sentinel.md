# Sentinel Security Discoveries

- **Secret Redaction Hardening**: Added comprehensive regex patterns for Anthropic, Stripe, GitHub, and JeanBot internal tokens to `packages/security/src/index.ts`. Used word boundaries (`\b`) to prevent false positives and ensured specific patterns (like `sk-ant-`) are matched correctly.
- **Terminal Command Guardrails**: Expanded `assertSafeCommand` in `services/terminal-service/src/index.ts` to block remote script piping (`| bash`, `| sh`), sensitive file access (`/etc/passwd`), and unauthorized system directory modifications (`> /etc/`).
- **Data Sanitization in Resumption**: Ensured that mission state persisted for resumption uses a safe serialization fallback (`asdict_fallback`) to prevent leaking or failing on non-serializable objects while maintaining state integrity.
