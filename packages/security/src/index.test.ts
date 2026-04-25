import { describe, expect, it } from "vitest";
import { redactSecrets, riskFromText, sanitizeData } from "./index.js";

describe("security package", () => {
  describe("redactSecrets", () => {
    it("redacts Anthropic keys", () => {
      const input = "my key is sk-ant-api01-ABC123_456-XYZ789";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_ANTHROPIC_KEY]");
    });

    it("redacts OpenAI keys", () => {
      const input = "my key is sk-proj-1234567890abcdef";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_OPENAI_KEY]");
    });

    it("redacts Google keys", () => {
      const input = "my key is AIzaSyA1234567890-ABCDE";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_GOOGLE_KEY]");
    });

    it("redacts Stripe keys", () => {
      const input = "my key is sk_live_1234567890ABCDEF";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_STRIPE_KEY]");
    });

    it("redacts GitHub tokens", () => {
      const input = "my key is ghp_1234567890abcdefGHIJKL";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_GITHUB_TOKEN]");
    });

    it("redacts JeanBot keys", () => {
      const input = "my key is jean_1234567890abcdefGHIJKL";
      expect(redactSecrets(input)).toBe("my key is [REDACTED_JEANBOT_KEY]");
    });

    it("redacts Bearer tokens", () => {
      const input = "Authorization: Bearer my.token.123";
      expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
    });

    it("does not redact partial matches", () => {
      const input = "not-sk-123 is safe";
      expect(redactSecrets(input)).toBe("not-sk-123 is safe");
    });
  });

  describe("riskFromText", () => {
    it("identifies critical risks", () => {
      expect(riskFromText("deploy to production")).toBe("critical");
      expect(riskFromText("delete everything")).toBe("critical");
      expect(riskFromText("drop table users")).toBe("critical");
    });

    it("identifies high risks", () => {
      expect(riskFromText("deploy the app")).toBe("high");
      expect(riskFromText("backup database")).toBe("high");
    });

    it("identifies medium risks", () => {
      expect(riskFromText("monitor logs")).toBe("medium");
      expect(riskFromText("analyze data")).toBe("medium");
    });

    it("identifies low risks", () => {
      expect(riskFromText("read file")).toBe("low");
    });
  });

  describe("sanitizeData", () => {
    it("recursively redacts secrets in objects", () => {
      const data = {
        config: {
          apiKey: "sk-ant-123",
          nested: {
            token: "ghp_456"
          }
        },
        items: ["sk-123", "AIza-789"],
        date: new Date("2026-03-12T12:00:00Z")
      };

      const sanitized = sanitizeData(data);
      expect(sanitized.config.apiKey).toBe("[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized.config.nested.token).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(sanitized.items[0]).toBe("[REDACTED_OPENAI_KEY]");
      expect(sanitized.items[1]).toBe("[REDACTED_GOOGLE_KEY]");
      expect(sanitized.date).toBeInstanceOf(Date);
    });
  });
});
