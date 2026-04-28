import { describe, it, expect } from "vitest";
import { generateEmbeddings, cosineSimilarity, normalizeEmbeddingText } from "./index.js";

describe("AI Utilities", () => {
  it("should normalize text", () => {
    expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
  });

  it("should generate synthetic embeddings", async () => {
    const [record] = await generateEmbeddings(["test"], { forceSynthetic: true });
    expect(record.values).toHaveLength(1536);
    expect(record.provider).toBe("synthetic");

    // Check if normalized
    const magnitude = Math.sqrt(record.values.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0, 5);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1, 5);
  });

  it("should handle empty or mismatched vectors in cosine similarity", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity(undefined, [1])).toBe(0);
  });
});
