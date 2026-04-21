import { describe, it, expect } from "vitest";
import { generateEmbedding, generateEmbeddings, cosineSimilarity } from "./index.js";

describe("AI Utilities", () => {
  it("generates synthetic embeddings", async () => {
    const text = "Hello world";
    const embedding = await generateEmbedding(text, { forceSynthetic: true });

    expect(embedding.values).toHaveLength(1536);
    expect(embedding.provider).toBe("synthetic");
    expect(embedding.contentHash).toBeDefined();
  });

  it("calculates cosine similarity correctly", () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1);
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0);
    expect(cosineSimilarity(vecA, undefined)).toBe(0);
  });

  it("handles batch generation", async () => {
    const texts = ["one", "two", "three"];
    const embeddings = await generateEmbeddings(texts, { forceSynthetic: true });

    expect(embeddings).toHaveLength(3);
    expect(embeddings[0].values).toHaveLength(1536);
  });
});
