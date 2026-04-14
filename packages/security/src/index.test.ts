import { describe, it, expect } from "vitest";
import { redactSecrets } from "./index.js";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    const input = "Here is my key: sk-abc123XYZ_456-789";
    const expected = "Here is my key: [REDACTED_OPENAI_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts Google API keys", () => {
    const input = "Google key: AIzaSyA1234567890-abcdefghij";
    const expected = "Google key: [REDACTED_GOOGLE_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abc123.def456.ghi789-jkl0";
    const expected = "Authorization: Bearer [REDACTED_TOKEN]";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts Anthropic keys specifically", () => {
    const input = "Anthropic key: sk-ant-api03-abcdef-123456";
    const expected = "Anthropic key: [REDACTED_ANTHROPIC_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts Stripe keys", () => {
    const input = "Stripe live: sk_live_51Pabc123XYZ, test: sk_test_51Pabc123XYZ";
    const expected = "Stripe live: [REDACTED_STRIPE_KEY], test: [REDACTED_STRIPE_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });

  it("redacts GitHub tokens", () => {
    const input = "GitHub ghp: ghp_abc123def456, pat: github_pat_11abc123_DEF456";
    const expected = "GitHub ghp: [REDACTED_GITHUB_KEY], pat: [REDACTED_GITHUB_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });
});
