import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  redactSecrets,
  riskFromText,
  sanitizeData,
} from "./index.ts";

describe("@jeanbot/security", () => {
  describe("risk assessment", () => {
    it("should classify critical terms", () => {
      expect(riskFromText("Please delete the database")).toBe("critical");
      expect(riskFromText("Truncate the logs")).toBe("critical");
      expect(riskFromText("Production environment access")).toBe("critical");
    });

    it("should classify high risk terms", () => {
      expect(riskFromText("Deploy the app")).toBe("high");
      expect(riskFromText("Rotate the secrets")).toBe("high");
      expect(riskFromText("Update password")).toBe("high");
    });

    it("should classify medium risk terms", () => {
      expect(riskFromText("Monitor performance")).toBe("medium");
      expect(riskFromText("Analyze usage")).toBe("medium");
    });

    it("should default to low risk", () => {
      expect(riskFromText("Read the readme")).toBe("low");
    });
  });

  describe("redaction", () => {
    it("should redact OpenAI keys", () => {
      const input = "Key: sk-123456789012345678901234567890";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_OPENAI_KEY]");
    });

    it("should redact Anthropic keys", () => {
      const input = "Key: sk-ant-12345";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_ANTHROPIC_KEY]");
    });

    it("should redact Google keys", () => {
      const input = "Key: AIza12345";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_GOOGLE_KEY]");
    });

    it("should redact Stripe keys", () => {
      const input = "Key: sk_live_12345";
      expect(redactSecrets(input)).toBe("Key: [REDACTED_STRIPE_KEY]");
    });

    it("should redact GitHub tokens", () => {
      expect(redactSecrets("ghp_12345")).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(redactSecrets("gho_12345")).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("should redact JeanBot keys", () => {
      expect(redactSecrets("jean_12345")).toBe("[REDACTED_JEANBOT_KEY]");
    });

    it("should redact Bearer tokens", () => {
      expect(redactSecrets("Bearer abc-123")).toBe("Bearer [REDACTED_TOKEN]");
    });

    it("should respect word boundaries", () => {
      expect(redactSecrets("task-ant-123")).toBe("task-ant-123");
      expect(redactSecrets("my-sk-123")).toBe("my-sk-123");
    });
  });

  describe("recursive sanitization", () => {
    it("should sanitize strings", () => {
      expect(sanitizeData("Key: sk-ant-123")).toBe("Key: [REDACTED_ANTHROPIC_KEY]");
    });

    it("should sanitize objects", () => {
      const input = {
        config: {
          apiKey: "sk-ant-123",
          timeout: 5000
        },
        name: "test"
      };
      const sanitized = sanitizeData(input);
      expect(sanitized.config.apiKey).toBe("[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized.config.timeout).toBe(5000);
    });

    it("should sanitize arrays", () => {
      const input = ["sk-ant-123", { token: "ghp_123" }];
      const sanitized = sanitizeData(input);
      expect(sanitized[0]).toBe("[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized[1].token).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("should preserve Date objects", () => {
      const date = new Date();
      const sanitized = sanitizeData({ createdAt: date });
      expect(sanitized.createdAt).toBeInstanceOf(Date);
      expect(sanitized.createdAt.getTime()).toBe(date.getTime());
      expect(sanitized.createdAt).not.toBe(date); // Should be a clone
    });
  });

  describe("encryption", () => {
    it("should encrypt and decrypt secrets", () => {
      const secret = "my-super-secret";
      const encrypted = encryptSecret(secret);
      expect(encrypted).not.toBe(secret);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("should handle undefined for decryption", () => {
      expect(decryptSecret(undefined)).toBeUndefined();
    });
  });
});
