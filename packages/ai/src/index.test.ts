
import { describe, it, expect } from "vitest";
import { syntheticVector, normalizeVector, cosineSimilarity } from "./index.js";

describe("ai package", () => {
  it("syntheticVector generates consistent vectors", () => {
    const v1 = syntheticVector("hello world");
    const v2 = syntheticVector("hello world");
    const v3 = syntheticVector("different text");

    expect(v1).toHaveLength(1536);
    expect(v1).toEqual(v2);
    expect(v1).not.toEqual(v3);

    // Check normalization
    const magnitude = Math.sqrt(v1.reduce((sum: number, val: number) => sum + val * val, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("normalizeVector normalizes correctly", () => {
    const v = [1, 1, 1, 1];
    const normalized = normalizeVector(v);
    const expectedVal = Number((1 / Math.sqrt(4)).toFixed(8));
    expect(normalized).toEqual([expectedVal, expectedVal, expectedVal, expectedVal]);
  });

  it("cosineSimilarity works as expected", () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [1, 1, 0];

    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1 / Math.sqrt(2), 5);
  });
});
