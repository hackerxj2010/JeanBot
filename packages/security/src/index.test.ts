import { describe, it, expect } from "vitest";
import { riskFromText, redactSecrets, encryptSecret, decryptSecret } from "../src/index";

describe("Security Utilities", () => {
  it("should evaluate risk correctly", () => {
    expect(riskFromText("I want to delete everything")).toBe("critical");
    expect(riskFromText("deploy the application")).toBe("high");
    expect(riskFromText("analyze the logs")).toBe("medium");
    expect(riskFromText("hello world")).toBe("low");
  });

  it("should redact secrets", () => {
    expect(redactSecrets("key: sk-12345")).toBe("key: [REDACTED_OPENAI_KEY]");
    expect(redactSecrets("key: AIza-12345")).toBe("key: [REDACTED_GOOGLE_KEY]");
    expect(redactSecrets("Bearer abc-123")).toBe("Bearer [REDACTED_TOKEN]");
  });

  it("should encrypt and decrypt secrets", () => {
    const plaintext = "super-secret-password";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});
