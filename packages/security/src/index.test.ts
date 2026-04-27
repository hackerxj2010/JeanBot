import { describe, it, expect } from "vitest";
import { redactSecrets, sanitizeData, riskFromText } from "./index.js";

describe("Security Utilities", () => {
  it("redacts various secrets with word boundaries", () => {
    const input = "Here is an OpenAI key: sk-12345 and an Anthropic key: sk-ant-abc. Don't touch my jean_secret.";
    const redacted = redactSecrets(input);

    expect(redacted).toContain("[REDACTED_OPENAI_KEY]");
    expect(redacted).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(redacted).toContain("[REDACTED_JEANBOT_KEY]");
    expect(redacted).not.toContain("sk-12345");
  });

  it("does not redact partial matches inside other words", () => {
    const input = "task-status-ok or ask-anything";
    const redacted = redactSecrets(input);
    expect(redacted).toBe(input);
  });

  it("recursively sanitizes complex objects", () => {
    const date = new Date();
    const data = {
      user: {
        name: "Alice",
        token: "sk-123"
      },
      tags: ["private", "ghp_token"],
      createdAt: date
    };

    const sanitized = sanitizeData(data);
    expect(sanitized.user.token).toBe("[REDACTED_OPENAI_KEY]");
    expect(sanitized.tags[1]).toBe("[REDACTED_GITHUB_TOKEN]");
    expect(sanitized.createdAt).toBeInstanceOf(Date);
    expect(sanitized.createdAt.getTime()).toBe(date.getTime());
    expect(sanitized.createdAt).not.toBe(date); // Should be a clone
  });

  it("evaluates risk levels correctly", () => {
    expect(riskFromText("Please delete all files")).toBe("critical");
    expect(riskFromText("Deploy to production")).toBe("critical");
    expect(riskFromText("Backup the database")).toBe("high");
    expect(riskFromText("Analyze the logs")).toBe("medium");
    expect(riskFromText("Read README.md")).toBe("low");
  });
});
