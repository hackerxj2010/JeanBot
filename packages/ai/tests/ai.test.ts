
import { describe, it, expect } from "vitest";
import { generateEmbeddings, cosineSimilarity } from "../src/index.js";

describe("AI Package Performance & Correctness", () => {
  it("should generate consistent synthetic vectors", async () => {
    const text = "test normalization and hashing";
    const [r1] = await generateEmbeddings([text], { forceSynthetic: true });
    const [r2] = await generateEmbeddings([text], { forceSynthetic: true });
    expect(r1.values).toHaveLength(1536);
    expect(r1.values).toEqual(r2.values);
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [1, 0, 0];
    expect(cosineSimilarity(v1, v2)).toBe(0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1, 7);
  });

  it("should generate embeddings for multiple inputs", async () => {
      const inputs = ["hello", "world"];
      const results = await generateEmbeddings(inputs, { forceSynthetic: true });
      expect(results).toHaveLength(2);
      expect(results[0].contentHash).toBeDefined();
      expect(results[0].values).toHaveLength(1536);
  });
});
