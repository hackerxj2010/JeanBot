## 2026-04-14 - Enhanced secret redaction for sub-agents and verification
**Vulnerability:** Sub-agents and verification tasks were potentially leaking sensitive keys (Stripe, GitHub, Anthropic) in their outputs if these keys were accidentally included in logs or generated text.
**Learning:** The existing `redactSecrets` only covered OpenAI, Google, and generic Bearer tokens. As the project supports more providers and integrations (Stripe, GitHub), the redaction logic needed to keep pace.
**Prevention:** Regularly update `redactSecrets` when adding new integrations or providers that use unique key formats.
