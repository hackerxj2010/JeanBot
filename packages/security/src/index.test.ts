import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeData } from "./index.js";

describe("Security Utils", () => {
  describe("redactSecrets", () => {
    it("should redact Anthropic keys", () => {
      const input = "Key: sk-ant-api01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxx";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_ANTHROPIC_KEY]");
    });

    it("should redact OpenAI keys", () => {
      const input = "Key: sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_OPENAI_KEY]");
    });

    it("should redact Google keys", () => {
      const input = "Key: AIzaSyB-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_GOOGLE_KEY]");
    });

    it("should redact JeanBot keys", () => {
      const input = "Key: jean_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_JEANBOT_KEY]");
    });

    it("should redact Bearer tokens", () => {
      const input = "Authorization: Bearer my.token.here";
      expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
    });

    it("should use word boundaries", () => {
      const input = "not-a-sk-ant-key";
      expect(redactSecrets(input)).toBe("not-a-sk-ant-key");
    });
  });

  describe("sanitizeData", () => {
    it("should redact secrets from nested objects", () => {
      const data = {
        config: {
          apiKey: "sk-ant-api01-xxxxxxxx"
        },
        items: ["jean_abc123", "normal-string"]
      };

      const sanitized = sanitizeData(data);
      expect(sanitized.config.apiKey).toBe("[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized.items[0]).toBe("[REDACTED_JEANBOT_KEY]");
      expect(sanitized.items[1]).toBe("normal-string");
    });

    it("should preserve Date objects", () => {
      const now = new Date();
      const data = { createdAt: now };
      const sanitized = sanitizeData(data);
      expect(sanitized.createdAt).toBeInstanceOf(Date);
      expect(sanitized.createdAt.getTime()).toBe(now.getTime());
    });
  });
});
