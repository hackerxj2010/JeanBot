import { describe, it, expect } from "vitest";
import { cosineSimilarity, generateEmbeddings, normalizeEmbeddingText, embeddingContentHash } from "./index.js";

describe("AI Utilities", () => {
  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it("should return 0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBe(0);
    });

    it("should return -1 for opposite vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [-1, 0, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1);
    });

    it("should handle empty or mismatched vectors", () => {
      expect(cosineSimilarity([], [1])).toBe(0);
      expect(cosineSimilarity([1], [])).toBe(0);
      expect(cosineSimilarity([1], [1, 2])).toBe(0);
    });
  });

  describe("syntheticVector", () => {
    it("should generate a normalized vector", async () => {
      const [record] = await generateEmbeddings(["test"], { forceSynthetic: true });
      expect(record.values.length).toBe(1536);
      const magnitude = Math.sqrt(record.values.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it("should be deterministic", async () => {
      const [r1] = await generateEmbeddings(["test"], { forceSynthetic: true });
      const [r2] = await generateEmbeddings(["test"], { forceSynthetic: true });
      expect(r1.values).toEqual(r2.values);
    });
  });

  describe("normalizeEmbeddingText", () => {
    it("should normalize whitespace", () => {
      expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
    });
  });

  describe("embeddingContentHash", () => {
    it("should return consistent hashes", () => {
      const h1 = embeddingContentHash("test");
      const h2 = embeddingContentHash("  test  ");
      expect(h1).toBe(h2);
    });
  });
});
