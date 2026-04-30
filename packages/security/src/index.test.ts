import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeData } from "./index.js";

describe("Security Package", () => {
  describe("redactSecrets", () => {
    it("redacts Anthropic keys", () => {
      const input = "Here is my key: sk-ant-api-key-123 and some text";
      expect(redactSecrets(input)).toBe("Here is my key: [REDACTED_ANTHROPIC_KEY] and some text");
    });

    it("redacts OpenAI keys", () => {
      const input = "My OpenAI key is sk-1234567890abcdef1234567890abcdef";
      expect(redactSecrets(input)).toBe("My OpenAI key is [REDACTED_OPENAI_KEY]");
    });

    it("redacts Google keys", () => {
      const input = "Google key: AIzaSyB1234567890";
      expect(redactSecrets(input)).toBe("Google key: [REDACTED_GOOGLE_KEY]");
    });

    it("redacts GitHub tokens", () => {
      const input = "ghp_1234567890abcdef1234567890abcdef";
      expect(redactSecrets(input)).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("redacts Stripe keys", () => {
      const input = "sk_live_1234567890";
      expect(redactSecrets(input)).toBe("[REDACTED_STRIPE_KEY]");
    });

    it("redacts JeanBot keys", () => {
      const input = "jean_1234567890";
      expect(redactSecrets(input)).toBe("[REDACTED_JEANBOT_KEY]");
    });

    it("uses strict word boundaries", () => {
      const input = "not-sk-ant-123 should not be redacted";
      expect(redactSecrets(input)).toBe("not-sk-ant-123 should not be redacted");
    });
  });

  describe("sanitizeData", () => {
    it("recursively redacts objects", () => {
      const data = {
        key: "sk-ant-123",
        nested: {
          token: "ghp_456"
        },
        list: ["jean_789", "normal"]
      };
      const sanitized = sanitizeData(data);
      expect(sanitized.key).toBe("[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized.nested.token).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(sanitized.list[0]).toBe("[REDACTED_JEANBOT_KEY]");
      expect(sanitized.list[1]).toBe("normal");
    });

    it("clones Date objects", () => {
      const now = new Date();
      const sanitized = sanitizeData(now);
      expect(sanitized).toEqual(now);
      expect(sanitized).not.toBe(now);
    });
  });
});
