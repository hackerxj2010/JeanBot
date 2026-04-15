import { describe, expect, it } from "vitest";
import { redactSecrets } from "./index.js";

describe("redactSecrets", () => {
  it("redacts OpenAI keys", () => {
    const input = "Here is my key: sk-abc123XYZ7890abc123XYZ7890abc123XYZ7890";
    expect(redactSecrets(input)).toBe("Here is my key: [REDACTED_OPENAI_KEY]");
  });

  it("redacts Google API keys", () => {
    const input = "Google key AIzaSyA1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
    expect(redactSecrets(input)).toBe("Google key [REDACTED_GOOGLE_KEY]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer my-secret-token.with.dots";
    expect(redactSecrets(input)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts Anthropic keys specifically", () => {
    const input = "Anthropic key: sk-ant-api03-abcdef123456-XYZ";
    expect(redactSecrets(input)).toBe("Anthropic key: [REDACTED_ANTHROPIC_KEY]");
  });

  it("redacts Stripe keys specifically", () => {
    const liveKey = "Stripe live: sk_live_51M0abc123";
    const testKey = "Stripe test: sk_test_51M0abc123";
    const restrictedKey = "Stripe restricted: rk_live_51M0abc123";
    expect(redactSecrets(liveKey)).toBe("Stripe live: [REDACTED_STRIPE_KEY]");
    expect(redactSecrets(testKey)).toBe("Stripe test: [REDACTED_STRIPE_KEY]");
    expect(redactSecrets(restrictedKey)).toBe("Stripe restricted: [REDACTED_STRIPE_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const pat = "GitHub PAT: ghp_abc123";
    const fineGrained = "GitHub PAT: github_pat_11ABC_xyz789";
    expect(redactSecrets(pat)).toBe("GitHub PAT: [REDACTED_GITHUB_TOKEN]");
    expect(redactSecrets(fineGrained)).toBe("GitHub PAT: [REDACTED_GITHUB_TOKEN]");
  });

  it("redacts JeanBot tokens", () => {
    const apiKey = "JeanBot Key: jean_abc123";
    const accessToken = "Session: jean_access_xyz789";
    const refreshToken = "Session: jean_refresh_def456";
    expect(redactSecrets(apiKey)).toBe("JeanBot Key: [REDACTED_JEANBOT_KEY]");
    expect(redactSecrets(accessToken)).toBe("Session: [REDACTED_JEANBOT_SESSION_TOKEN]");
    expect(redactSecrets(refreshToken)).toBe("Session: [REDACTED_JEANBOT_SESSION_TOKEN]");
  });

  it("handles multiple secrets in one string", () => {
    const input = "OpenAI: sk-123, Anthropic: sk-ant-456, Stripe: sk_live_789";
    const expected = "OpenAI: [REDACTED_OPENAI_KEY], Anthropic: [REDACTED_ANTHROPIC_KEY], Stripe: [REDACTED_STRIPE_KEY]";
    expect(redactSecrets(input)).toBe(expected);
  });
});
