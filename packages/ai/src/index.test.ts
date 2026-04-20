import { describe, expect, it } from "vitest";
import { cosineSimilarity, generateEmbedding } from "../src/index";

describe("@jeanbot/ai", () => {
  it("should generate a synthetic embedding", async () => {
    const text = "hello world";
    const embedding = await generateEmbedding(text, { forceSynthetic: true });
    expect(embedding.values).toHaveLength(1536);
    expect(embedding.provider).toBe("synthetic");
    expect(embedding.contentHash).toBeDefined();
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [1, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(Math.SQRT1_2);
  });

  it("should handle empty or mismatched vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity(undefined, [1])).toBe(0);
  });
});
