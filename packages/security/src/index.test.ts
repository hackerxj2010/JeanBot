import { describe, expect, it } from "vitest";
import { redactSecrets, riskFromText } from "./index.js";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    const input = "Here is my key: sk-1234567890abcdef1234567890abcdef";
    expect(redactSecrets(input)).toBe("Here is my key: [REDACTED_OPENAI_KEY]");
  });

  it("redacts Anthropic keys", () => {
    const input = "Anthropic key is sk-ant-1234567890abcdef1234567890abcdef";
    expect(redactSecrets(input)).toBe("Anthropic key is [REDACTED_ANTHROPIC_KEY]");
  });

  it("redacts Google keys", () => {
    const input = "Google AIzaSyB1234567890abcdef1234567890abcdef";
    expect(redactSecrets(input)).toBe("Google [REDACTED_GOOGLE_KEY]");
  });

  it("redacts Stripe keys", () => {
    expect(redactSecrets("sk_live_12345")).toBe("[REDACTED_STRIPE_KEY]");
    expect(redactSecrets("sk_test_12345")).toBe("[REDACTED_STRIPE_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const input = "ghp_123456789012345678901234567890123456";
    expect(redactSecrets(input)).toBe("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts JeanBot keys", () => {
    const input = "jean_12345678901234567890123456789012";
    expect(redactSecrets(input)).toBe("[REDACTED_JEANBOT_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer my.secret.token";
    expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("respects word boundaries", () => {
    const input = "not-sk-ant-key and my-sk-key";
    expect(redactSecrets(input)).toBe(input);
  });
});

describe("riskFromText", () => {
  it("identifies critical risk", () => {
    expect(riskFromText("I need to delete the production database")).toBe("critical");
    expect(riskFromText("Send a payment of $100")).toBe("critical");
  });

  it("identifies high risk", () => {
    expect(riskFromText("Deploy to staging")).toBe("high");
    expect(riskFromText("Restore the backup")).toBe("high");
  });

  it("identifies medium risk", () => {
    expect(riskFromText("Monitor the logs")).toBe("medium");
    expect(riskFromText("Analyze the traffic")).toBe("medium");
  });

  it("identifies low risk", () => {
    expect(riskFromText("Hello JeanBot")).toBe("low");
  });
});
