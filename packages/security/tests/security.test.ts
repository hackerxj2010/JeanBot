import { describe, expect, it } from "vitest";
import { redactSecrets, riskFromText } from "../src/index.js";

describe("Security Package", () => {
  it("should redact Anthropic keys", () => {
    const input = "Here is my key: sk-ant-api01-xxxxxxxxxxxxxxx";
    expect(redactSecrets(input)).toContain("[REDACTED_ANTHROPIC_KEY]");
  });

  it("should redact OpenAI keys", () => {
    const input = "OpenAI key is sk-1234567890abcdef";
    expect(redactSecrets(input)).toContain("[REDACTED_OPENAI_KEY]");
  });

  it("should classify critical risk", () => {
    expect(riskFromText("delete production database")).toBe("critical");
    expect(riskFromText("transfer money")).toBe("critical");
  });

  it("should classify high risk", () => {
    expect(riskFromText("deploy to staging")).toBe("high");
  });
});
