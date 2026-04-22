
import { describe, it, expect } from "vitest";
import { generateEmbedding, generateEmbeddings, cosineSimilarity, embeddingContentHash } from "./index.ts";

describe("AI Package", () => {
  describe("generateEmbedding", () => {
    it("should generate a synthetic embedding", async () => {
      const record = await generateEmbedding("hello world", { forceSynthetic: true });
      expect(record.provider).toBe("synthetic");
      expect(record.values.length).toBe(1536);
      expect(record.contentHash).toBeDefined();
    });
  });

  describe("cosineSimilarity", () => {
    it("should calculate similarity correctly for identical vectors", () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("should calculate similarity correctly for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBe(0);
    });

    it("should calculate similarity correctly for opposite vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [-1, 0, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });

    it("should return 0 for empty vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("embeddingContentHash", () => {
    it("should return consistent hash for same input", () => {
      const h1 = embeddingContentHash("test");
      const h2 = embeddingContentHash("test");
      expect(h1).toBe(h2);
    });

    it("should return different hash for different input", () => {
      const h1 = embeddingContentHash("test1");
      const h2 = embeddingContentHash("test2");
      expect(h1).not.toBe(h2);
    });
  });
});
