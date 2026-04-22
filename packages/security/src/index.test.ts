import { describe, expect, it } from "vitest";
import { redactSecrets, riskFromText, sanitizeData } from "./index.js";

describe("security utils", () => {
  describe("riskFromText", () => {
    it("should classify production as critical", () => {
      expect(riskFromText("this is production")).toBe("critical");
    });

    it("should classify staging as low (default)", () => {
        expect(riskFromText("this is staging")).toBe("low");
    });
  });

  describe("redactSecrets", () => {
    it("should redact OpenAI keys", () => {
      expect(redactSecrets("sk-1234567890abcdef1234567890abcdef")).toBe("[REDACTED_OPENAI_KEY]");
    });

    it("should redact Anthropic keys", () => {
      expect(redactSecrets("sk-ant-1234567890abcdef1234567890abcdef")).toBe("[REDACTED_ANTHROPIC_KEY]");
    });

    it("should redact Google keys", () => {
      expect(redactSecrets("AIza1234567890abcdef1234567890abcdef")).toBe("[REDACTED_GOOGLE_KEY]");
    });

    it("should redact Stripe keys", () => {
      expect(redactSecrets("sk_live_1234567890")).toBe("[REDACTED_STRIPE_KEY]");
      expect(redactSecrets("sk_test_1234567890")).toBe("[REDACTED_STRIPE_KEY]");
    });

    it("should redact GitHub tokens", () => {
      expect(redactSecrets("ghp_1234567890abcdef")).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("should redact JeanBot tokens", () => {
      expect(redactSecrets("jean_1234567890abcdef")).toBe("[REDACTED_JEANBOT_TOKEN]");
    });

    it("should redact Bearer tokens", () => {
      expect(redactSecrets("Bearer abc.def.ghi")).toBe("Bearer [REDACTED_TOKEN]");
    });

    it("should not redact partial matches", () => {
        expect(redactSecrets("not-sk-123")).toBe("not-sk-123");
    });
  });

  describe("sanitizeData", () => {
    it("should redact secrets in objects", () => {
      const data = {
        key: "sk-123",
        nested: {
          token: "Bearer abc"
        }
      };
      const sanitized = sanitizeData(data);
      expect(sanitized.key).toBe("[REDACTED_OPENAI_KEY]");
      expect(sanitized.nested.token).toBe("Bearer [REDACTED_TOKEN]");
    });

    it("should redact secrets in arrays", () => {
      const data = ["sk-123", { token: "ghp_abc" }];
      const sanitized = sanitizeData(data);
      expect(sanitized[0]).toBe("[REDACTED_OPENAI_KEY]");
      expect(sanitized[1].token).toBe("[REDACTED_GITHUB_TOKEN]");
    });
  });
});
