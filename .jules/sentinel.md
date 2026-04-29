## 2026-04-29 - [Terminal Command Guardrails and Secret Redaction]
**Vulnerability:** Dangerous terminal commands (like `rm -rf /` or reading `/etc/passwd`) were either incorrectly blocked due to faulty regex or not blocked at all. Additionally, terminal output previews could leak sensitive API keys (OpenAI, Anthropic, etc.) into logs.
**Learning:** Regex word boundaries (`\b`) do not work as expected when used after non-word characters like `/`. The pattern `/\brm\s+-rf\s+\/\b/i` failed to match `rm -rf /` because there is no word boundary after the trailing slash.
**Prevention:** Avoid trailing `\b` in regex patterns ending with non-word characters. Always integrate secret redaction into any service that generates human-readable previews or logs of tool outputs.
