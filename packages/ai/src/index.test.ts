import { describe, it, expect } from "vitest";
import { generateEmbeddings, cosineSimilarity } from "./index.js";

describe("@jeanbot/ai", () => {
  it("should generate synthetic embeddings", async () => {
    const input = "test content";
    const [result] = await generateEmbeddings([input], { forceSynthetic: true });

    expect(result.values).toHaveLength(1536);
    expect(result.provider).toBe("synthetic");
    expect(typeof result.values[0]).toBe("number");
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0, 5);
  });
});
