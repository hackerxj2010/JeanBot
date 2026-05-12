import { describe, it, expect } from "vitest";
import { assertInternalRequest } from "../../packages/platform/src/index.js";
import { redactSecrets } from "../../packages/security/src/index.js";

describe("redactSecrets", () => {
  it("should redact Anthropic keys", () => {
    expect(redactSecrets("key: sk-ant-abc-123")).toBe("key: [REDACTED_ANTHROPIC_KEY]");
  });

  it("should redact OpenAI keys", () => {
    expect(redactSecrets("key: sk-abc-123")).toBe("key: [REDACTED_OPENAI_KEY]");
  });
});

describe("assertInternalRequest", () => {
  const validToken = "test-token";

  it("should accept a valid token", () => {
    expect(() => {
      assertInternalRequest({ "x-jeanbot-internal-token": validToken }, validToken);
    }).not.toThrow();
  });

  it("should accept a valid token in an array", () => {
    expect(() => {
      assertInternalRequest({ "x-jeanbot-internal-token": [validToken] }, validToken);
    }).not.toThrow();
  });

  it("should throw for an invalid token", () => {
    expect(() => {
      assertInternalRequest({ "x-jeanbot-internal-token": "wrong-token" }, validToken);
    }).toThrow("Unauthorized internal service request.");
  });

  it("should throw for a missing token", () => {
    expect(() => {
      assertInternalRequest({}, validToken);
    }).toThrow("Unauthorized internal service request.");
  });
});
