import { describe, it, expect } from "vitest";
import { cosineSimilarity, generateEmbedding, syntheticVector } from "./index.js";

describe("AI Utilities", () => {
  it("calculates cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [1, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBe(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(Math.sqrt(0.5));
  });

  it("generates synthetic embeddings", async () => {
    const text = "hello world";
    const embedding = await generateEmbedding(text, { forceSynthetic: true });

    expect(embedding.values.length).toBe(1536);
    expect(embedding.provider).toBe("synthetic");
    expect(embedding.contentHash).toBeDefined();

    // Test stability
    const embedding2 = await generateEmbedding(text, { forceSynthetic: true });
    expect(embedding2.values).toEqual(embedding.values);
  });

  it("normalizes vectors", () => {
    const v = [3, 4]; // magnitude 5
    const record = (syntheticVector as any)("test", 2);
    // We can't easily test internal normalizeVector without exporting it,
    // but we can test that syntheticVector produces normalized output.

    const magSq = record.reduce((sum: number, val: number) => sum + val * val, 0);
    expect(magSq).toBeCloseTo(1, 5);
  });
});
