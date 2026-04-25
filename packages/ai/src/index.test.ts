import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  generateEmbeddings,
  embeddingContentHash,
  normalizeEmbeddingText,
  embeddingDimensions
} from "../src/index";

describe("AI Utilities", () => {
  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [1, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBe(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(Math.sqrt(0.5));
  });

  it("should handle empty or mismatched vectors in cosine similarity", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity(undefined, [1])).toBe(0);
  });

  it("should generate synthetic embeddings", async () => {
    const inputs = ["hello world", "foo bar"];
    const embeddings = await generateEmbeddings(inputs, { forceSynthetic: true });

    expect(embeddings).toHaveLength(2);
    expect(embeddings[0].values).toHaveLength(embeddingDimensions);
    expect(embeddings[0].provider).toBe("synthetic");
    expect(embeddings[0].contentHash).toBe(embeddingContentHash("hello world"));
  });

  it("should normalize text consistently", () => {
    expect(normalizeEmbeddingText("  hello   world  ")).toBe("hello world");
  });

  it("should generate consistent hashes", () => {
    const h1 = embeddingContentHash("hello world");
    const h2 = embeddingContentHash("  hello   world  ");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});
