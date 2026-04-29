import { describe, it, expect } from "vitest";
import { syntheticVector, cosineSimilarity, normalizeEmbeddingText, embeddingContentHash } from "./index.js";

describe("@jeanbot/ai", () => {
  describe("syntheticVector", () => {
    it("generates a vector of the correct dimensions", () => {
      const dimensions = 100;
      const vector = syntheticVector("test", dimensions);
      expect(vector).toHaveLength(dimensions);
    });

    it("generates consistent vectors for the same input", () => {
      const v1 = syntheticVector("hello");
      const v2 = syntheticVector("hello");
      expect(v1).toEqual(v2);
    });

    it("generates different vectors for different inputs", () => {
      const v1 = syntheticVector("hello");
      const v2 = syntheticVector("world");
      expect(v1).not.toEqual(v2);
    });

    it("is normalized (magnitude is approx 1)", () => {
      const vector = syntheticVector("normalize me");
      const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBe(0);
    });

    it("returns -1 for opposite vectors", () => {
      const v1 = [1, 0];
      const v2 = [-1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });

    it("handles undefined or empty vectors", () => {
      expect(cosineSimilarity(undefined, [1])).toBe(0);
      expect(cosineSimilarity([1], undefined)).toBe(0);
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("hashing and normalization", () => {
    it("normalizes text consistently", () => {
      expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
    });

    it("generates consistent content hashes", () => {
      const h1 = embeddingContentHash("test");
      const h2 = embeddingContentHash("  test  ");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64); // SHA-256 hex
    });
  });
});
