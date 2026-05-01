import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeData, riskFromText } from "./index.js";

describe("Security Package", () => {
  describe("redactSecrets", () => {
    it("should redact OpenAI keys", () => {
      const input = "Here is my key: sk-abc123xyz789";
      expect(redactSecrets(input)).toBe("Here is my key: [REDACTED_OPENAI_KEY]");
    });

    it("should redact Anthropic keys specifically", () => {
      const input = "Anthropic key: sk-ant-abc123xyz789";
      expect(redactSecrets(input)).toBe("Anthropic key: [REDACTED_ANTHROPIC_KEY]");
    });

    it("should redact GitHub tokens", () => {
      const input = "GitHub token: ghp_abc123xyz789";
      expect(redactSecrets(input)).toBe("GitHub token: [REDACTED_GITHUB_TOKEN]");
    });

    it("should redact Stripe keys", () => {
      const input = "Stripe live key: sk_live_abc123xyz789";
      expect(redactSecrets(input)).toBe("Stripe live key: [REDACTED_STRIPE_KEY]");
    });

    it("should redact JeanBot keys", () => {
      const input = "JeanBot key: jean_abc123xyz789";
      expect(redactSecrets(input)).toBe("JeanBot key: [REDACTED_JEANBOT_KEY]");
    });

    it("should use strict word boundaries", () => {
      const input = "not-sk-abc123xyz789-not";
      expect(redactSecrets(input)).toBe("not-sk-abc123xyz789-not");
    });
  });

  describe("sanitizeData", () => {
    it("should recursively redact secrets from objects", () => {
      const data = {
        config: {
          apiKey: "sk-abc123xyz789",
          nested: {
            token: "ghp_abc123xyz789"
          }
        },
        other: "normal text"
      };
      const sanitized = sanitizeData(data);
      expect(sanitized.config.apiKey).toBe("[REDACTED_OPENAI_KEY]");
      expect(sanitized.config.nested.token).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(sanitized.other).toBe("normal text");
    });

    it("should preserve Date objects", () => {
      const now = new Date();
      const data = { createdAt: now };
      const sanitized = sanitizeData(data);
      expect(sanitized.createdAt).toBeInstanceOf(Date);
      expect(sanitized.createdAt.getTime()).toBe(now.getTime());
    });
  });

  describe("riskFromText", () => {
    it("should identify critical risks", () => {
      expect(riskFromText("delete everything")).toBe("critical");
      expect(riskFromText("transfer funds")).toBe("critical");
    });

    it("should identify high risks", () => {
      expect(riskFromText("deploy to staging")).toBe("high");
      expect(riskFromText("backup database")).toBe("high");
    });

    it("should default to low risk", () => {
      expect(riskFromText("read file")).toBe("low");
    });
  });
});
