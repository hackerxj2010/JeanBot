import { describe, expect, it } from "vitest";
import { assertInternalRequest } from "../../packages/platform/src/index.js";

describe("assertInternalRequest security", () => {
  const validToken = "test-internal-token";

  it("should succeed with a valid token", () => {
    const headers = { "x-jeanbot-internal-token": validToken };
    expect(() => assertInternalRequest(headers, validToken)).not.toThrow();
  });

  it("should succeed with a valid token in an array", () => {
    const headers = { "x-jeanbot-internal-token": [validToken] };
    expect(() => assertInternalRequest(headers, validToken)).not.toThrow();
  });

  it("should throw with an invalid token", () => {
    const headers = { "x-jeanbot-internal-token": "wrong-token" };
    expect(() => assertInternalRequest(headers, validToken)).toThrow("Unauthorized internal service request.");
  });

  it("should throw with a missing token", () => {
    const headers = {};
    expect(() => assertInternalRequest(headers, validToken)).toThrow("Unauthorized internal service request.");
  });

  it("should throw with an empty token", () => {
    const headers = { "x-jeanbot-internal-token": "" };
    expect(() => assertInternalRequest(headers, validToken)).toThrow("Unauthorized internal service request.");
  });

  it("should throw with a token of different length", () => {
    const headers = { "x-jeanbot-internal-token": "short" };
    expect(() => assertInternalRequest(headers, validToken)).toThrow("Unauthorized internal service request.");
  });
});
