import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  embeddingContentHash,
  generateEmbedding,
  generateEmbeddings,
  normalizeEmbeddingText,
  normalizeVector,
  syntheticVector,
} from "./index.ts";

describe("@jeanbot/ai", () => {
  describe("normalization", () => {
    it("should normalize text by removing extra whitespace", () => {
      expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
    });

    it("should normalize vectors to unit length", () => {
      const v = [3, 4];
      const normalized = normalizeVector(v);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);

      const magnitude = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it("should handle zero vectors", () => {
      expect(normalizeVector([0, 0])).toEqual([0, 0]);
    });
  });

  describe("content hashing", () => {
    it("should produce consistent hashes for same content", () => {
      const h1 = embeddingContentHash("test content");
      const h2 = embeddingContentHash("  test   content  ");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });
  });

  describe("synthetic vectors", () => {
    it("should generate deterministic vectors for text", () => {
      const v1 = syntheticVector("deterministic test", 128);
      const v2 = syntheticVector("deterministic test", 128);
      const v3 = syntheticVector("different text", 128);

      expect(v1).toEqual(v2);
      expect(v1).not.toEqual(v3);
      expect(v1).toHaveLength(128);
    });

    it("should generate normalized synthetic vectors", () => {
      const v = syntheticVector("normalized check", 1536);
      const sumSq = v.reduce((sum, val) => sum + val * val, 0);
      expect(sumSq).toBeCloseTo(1, 5);
    });
  });

  describe("cosine similarity", () => {
    it("should return 1 for identical vectors", () => {
      const v = normalizeVector([1, 2, 3]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });

    it("should return -1 for opposite vectors", () => {
      const v1 = [1, 0];
      const v2 = [-1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });

    it("should handle different length vectors by returning 0", () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
  });

  describe("embedding generation", () => {
    it("should generate synthetic embeddings when forced", async () => {
      const input = "test embedding";
      const record = await generateEmbedding(input, { forceSynthetic: true });

      expect(record.provider).toBe("synthetic");
      expect(record.values).toHaveLength(1536);
      expect(record.contentHash).toBe(embeddingContentHash(input));
    });

    it("should generate batch embeddings", async () => {
      const inputs = ["one", "two", "three"];
      const records = await generateEmbeddings(inputs, { forceSynthetic: true });

      expect(records).toHaveLength(3);
      expect(records[0]?.contentHash).toBe(embeddingContentHash("one"));
      expect(records[1]?.contentHash).toBe(embeddingContentHash("two"));
      expect(records[2]?.contentHash).toBe(embeddingContentHash("three"));
    });
  });
});
