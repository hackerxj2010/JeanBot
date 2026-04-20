import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeData } from "./index.js";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    const input = "my key is sk-abc123XYZ";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_OPENAI_KEY]");
  });

  it("redacts Google keys", () => {
    const input = "google key: AIzaSyA123456789";
    expect(redactSecrets(input)).toBe("google key: [REDACTED_GOOGLE_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abc.123.xyz-789";
    expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts Anthropic keys", () => {
    const input = "anthropic: sk-ant-api03-xxx-yyy";
    expect(redactSecrets(input)).toBe("anthropic: [REDACTED_ANTHROPIC_KEY]");
  });

  it("redacts JeanBot keys", () => {
    const input = "jeanbot: jean_1234567890abcdef";
    expect(redactSecrets(input)).toBe("jeanbot: [REDACTED_JEANBOT_KEY]");
  });

  it("redacts Stripe keys", () => {
    const input = "stripe: sk_live_1234567890abcdef";
    expect(redactSecrets(input)).toBe("stripe: [REDACTED_STRIPE_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const input = "github: ghp_1234567890abcdef";
    expect(redactSecrets(input)).toBe("github: [REDACTED_GITHUB_TOKEN]");
  });
});

describe("sanitizeData", () => {
  it("sanitizes nested objects", () => {
    const input = {
      apiKey: "sk-123",
      config: {
        token: "Bearer abc",
        list: ["jean_456", "safe"]
      }
    };
    const expected = {
      apiKey: "[REDACTED_OPENAI_KEY]",
      config: {
        token: "Bearer [REDACTED_TOKEN]",
        list: ["[REDACTED_JEANBOT_KEY]", "safe"]
      }
    };
    expect(sanitizeData(input)).toEqual(expected);
  });
});
