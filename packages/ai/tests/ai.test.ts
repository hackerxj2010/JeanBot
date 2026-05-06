import { describe, expect, it } from "vitest";
import { generateEmbedding, cosineSimilarity, embeddingContentHash } from "../src/index.js";

describe("AI Package", () => {
  it("should generate synthetic embeddings", async () => {
    const text = "Hello world";
    const record = await generateEmbedding(text, { forceSynthetic: true });
    expect(record.provider).toBe("synthetic");
    expect(record.values.length).toBe(1536);
    expect(record.contentHash).toBe(embeddingContentHash(text));
  });

  it("should calculate cosine similarity", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0);
  });

  it("should generate stable synthetic vectors", async () => {
    const text = "Stable vector test";
    const r1 = await generateEmbedding(text, { forceSynthetic: true });
    const r2 = await generateEmbedding(text, { forceSynthetic: true });
    expect(r1.values).toEqual(r2.values);
  });
});
