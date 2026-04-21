import { describe, it, expect } from "vitest";
import { redactSecrets, sanitizeData } from "./index.js";

describe("redactSecrets", () => {
  it("should redact OpenAI keys", () => {
    const input = "my key is sk-1234567890abcdef1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_OPENAI_KEY]");
  });

  it("should redact Google keys", () => {
    const input = "my key is AIzaSyA1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_GOOGLE_KEY]");
  });

  it("should redact Bearer tokens", () => {
    const input = "Authorization: Bearer my.token.here";
    expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("should redact Anthropic keys specifically", () => {
    const input = "my key is sk-ant-1234567890abcdef";
    expect(redactSecrets(input)).toBe("my key is [REDACTED_ANTHROPIC_KEY]");
  });

  it("should redact GitHub tokens", () => {
    const input = "github token ghp_1234567890abcdef";
    expect(redactSecrets(input)).toBe("github token [REDACTED_GITHUB_TOKEN]");
  });

  it("should redact Stripe keys", () => {
    const input = "stripe sk_live_1234567890abcdef";
    expect(redactSecrets(input)).toBe("stripe [REDACTED_STRIPE_KEY]");
  });

  it("should redact JeanBot tokens", () => {
    const input = "jeanbot token jean_1234567890abcdef";
    expect(redactSecrets(input)).toBe("jeanbot token [REDACTED_JEANBOT_TOKEN]");
  });

  it("should honor word boundaries", () => {
    const input = "not-sk-123 is fine, but sk-123 is not";
    expect(redactSecrets(input)).toBe("not-sk-123 is fine, but [REDACTED_OPENAI_KEY] is not");
  });
});

describe("sanitizeData", () => {
  it("should sanitize strings", () => {
    expect(sanitizeData("my key is sk-123")).toBe("my key is [REDACTED_OPENAI_KEY]");
  });

  it("should sanitize arrays", () => {
    const input = ["sk-123", "safe string"];
    expect(sanitizeData(input)).toEqual(["[REDACTED_OPENAI_KEY]", "safe string"]);
  });

  it("should sanitize nested objects", () => {
    const input = {
      apiKey: "sk-123",
      nested: {
        token: "ghp_abc",
        safe: 123
      }
    };
    expect(sanitizeData(input)).toEqual({
      apiKey: "[REDACTED_OPENAI_KEY]",
      nested: {
        token: "[REDACTED_GITHUB_TOKEN]",
        safe: 123
      }
    });
  });

  it("should handle null and other types", () => {
    expect(sanitizeData(null)).toBe(null);
    expect(sanitizeData(123)).toBe(123);
    expect(sanitizeData(true)).toBe(true);
  });
});
