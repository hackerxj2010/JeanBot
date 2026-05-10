import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../packages/security/src/index.js";

describe("Security Redaction", () => {
  it("redacts Anthropic keys", () => {
    const input = "My key is sk-ant-at03-somekey-12345";
    expect(redactSecrets(input)).toBe("My key is [REDACTED_ANTHROPIC_KEY]");
  });

  it("redacts OpenAI keys", () => {
    const input = "My key is sk-some-openai-key";
    expect(redactSecrets(input)).toBe("My key is [REDACTED_OPENAI_KEY]");
  });

  it("prioritizes Anthropic over OpenAI", () => {
    const input = "Anthropic: sk-ant-some-key, OpenAI: sk-some-key";
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(redacted).toContain("[REDACTED_OPENAI_KEY]");
  });
});
