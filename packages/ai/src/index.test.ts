import { describe, expect, it } from "vitest";
import { cosineSimilarity, generateEmbedding, normalizeEmbeddingText, embeddingContentHash } from "./index.js";

describe("ai package", () => {
  it("should normalize text", () => {
    expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
  });

  it("should generate content hash", () => {
    const hash = embeddingContentHash("test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(embeddingContentHash("  test  ")).toBe(hash);
  });

  it("should calculate cosine similarity", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1);
    expect(cosineSimilarity(undefined, v1)).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it("should generate synthetic embedding", async () => {
    const embedding = await generateEmbedding("hello world", { forceSynthetic: true });
    expect(embedding.values).toHaveLength(1536);
    expect(embedding.provider).toBe("synthetic");
    expect(embedding.contentHash).toBe(embeddingContentHash("hello world"));

    // Check normalization (magnitude should be 1)
    const magnitude = Math.sqrt(embedding.values.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("should be deterministic for synthetic embeddings", async () => {
    const e1 = await generateEmbedding("test", { forceSynthetic: true });
    const e2 = await generateEmbedding("test", { forceSynthetic: true });
    expect(e1.values).toEqual(e2.values);
  });
});
