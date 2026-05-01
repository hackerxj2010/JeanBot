import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/index.js";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    const input = "my key is sk-1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_OPENAI_KEY]");
  });

  it("redacts Anthropic keys specifically", () => {
    const input = "my key is sk-ant-1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_ANTHROPIC_KEY]");
  });

  it("redacts Google keys", () => {
    const input = "my key is AIza1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_GOOGLE_KEY]");
  });

  it("redacts Stripe keys", () => {
    const input = "my key is sk_live_1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_STRIPE_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const input = "my token is ghp_1234567890abcdef";
    expect(redactSecrets(input)).toBe("my token is [REDACTED_GITHUB_TOKEN]");
  });

  it("redacts JeanBot keys", () => {
    const input = "my key is jean_1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_JEANBOT_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer my-token.123";
    expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("honors word boundaries", () => {
    const input = "not-sk-key and sk-key";
    expect(redactSecrets(input)).toBe("not-sk-key and [REDACTED_OPENAI_KEY]");
  });

  it("handles multiple secrets", () => {
    const input = "sk-123 and AIza456";
    expect(redactSecrets(input)).toBe("[REDACTED_OPENAI_KEY] and [REDACTED_GOOGLE_KEY]");
  });
});
