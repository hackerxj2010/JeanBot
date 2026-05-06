import { describe, expect, it } from "vitest";
import { generateEmbedding, embeddingContentHash, normalizeEmbeddingText, cosineSimilarity } from "./index.js";

describe("@jeanbot/ai", () => {
  it("should generate a consistent content hash", () => {
    const text = "  Hello   World  ";
    const hash = embeddingContentHash(text);
    expect(hash).toBe(embeddingContentHash("Hello World"));
    expect(hash).toBeTypeOf("string");
    expect(hash).toHaveLength(64);
  });

  it("should normalize text correctly", () => {
    expect(normalizeEmbeddingText("  multiple   spaces  ")).toBe("multiple spaces");
  });

  it("should generate a synthetic embedding", async () => {
    const text = "test synthetic embedding";
    const result = await generateEmbedding(text, { forceSynthetic: true });

    expect(result.provider).toBe("synthetic");
    expect(result.values).toHaveLength(1536);
    expect(result.contentHash).toBe(embeddingContentHash(text));

    // Check if it's normalized (magnitude close to 1)
    const magnitude = Math.sqrt(result.values.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1);
  });
});
