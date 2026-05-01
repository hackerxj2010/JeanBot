import { describe, it, expect } from "vitest";
import { generateEmbeddings, cosineSimilarity } from "./index.js";

describe("AI package", () => {
  it("generates synthetic embeddings correctly", async () => {
    const input = "test text";
    const [result] = await generateEmbeddings([input], { forceSynthetic: true });

    expect(result.values).toHaveLength(1536);
    expect(result.contentHash).toBeDefined();
    expect(result.provider).toBe("synthetic");

    // Check normalization (magnitude should be 1)
    const magnitude = Math.sqrt(result.values.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 4);
  });

  it("calculates cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1);
  });

  it("produces consistent synthetic vectors for same input", async () => {
    const text = "consistent text";
    const [r1] = await generateEmbeddings([text], { forceSynthetic: true });
    const [r2] = await generateEmbeddings([text], { forceSynthetic: true });

    expect(r1.values).toEqual(r2.values);
  });
});
