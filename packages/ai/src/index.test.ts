
import { describe, it, expect } from "vitest";
import { syntheticVector, cosineSimilarity, normalizeVector } from "./index";

describe("AI Utilities", () => {
  it("should generate a synthetic vector of correct dimensions", () => {
    const dimensions = 100;
    const vector = syntheticVector("test text", dimensions);
    expect(vector).toHaveLength(dimensions);
  });

  it("should generate consistent vectors for the same input", () => {
    const v1 = syntheticVector("same text");
    const v2 = syntheticVector("same text");
    expect(v1).toEqual(v2);
  });

  it("should generate different vectors for different input", () => {
    const v1 = syntheticVector("text one");
    const v2 = syntheticVector("text two");
    expect(v1).not.toEqual(v2);
  });

  it("should normalize vectors correctly", () => {
    const v = [3, 4];
    const normalized = normalizeVector(v);
    expect(normalized[0]).toBeCloseTo(0.6, 8);
    expect(normalized[1]).toBeCloseTo(0.8, 8);

    const magnitude = Math.sqrt(normalized[0]! * normalized[0]! + normalized[1]! * normalized[1]!);
    expect(magnitude).toBeCloseTo(1, 8);
  });

  it("should calculate cosine similarity correctly", () => {
    const v1 = [1, 0];
    const v2 = [0, 1];
    const v3 = [1, 1];

    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 8);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 8);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1 / Math.sqrt(2), 8);
  });

  it("should handle edge cases in cosine similarity", () => {
    expect(cosineSimilarity(undefined, [1])).toBe(0);
    expect(cosineSimilarity([1], undefined)).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
