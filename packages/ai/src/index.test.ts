import { describe, expect, it } from "vitest";
import { generateEmbedding, cosineSimilarity, embeddingContentHash } from "./index.js";

describe("AI Package", () => {
  it("should generate synthetic embeddings", async () => {
    const record = await generateEmbedding("test input", { forceSynthetic: true });
    expect(record.values).toHaveLength(1536);
    expect(record.provider).toBe("synthetic");
    expect(record.contentHash).toBe(embeddingContentHash("test input"));
  });

  it("should be deterministic", async () => {
    const r1 = await generateEmbedding("deterministic", { forceSynthetic: true });
    const r2 = await generateEmbedding("deterministic", { forceSynthetic: true });
    expect(r1.values).toEqual(r2.values);
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBe(0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1);
  });

  it("should handle empty or mismatched vectors in cosine similarity", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity(undefined, [1])).toBe(0);
  });
});
