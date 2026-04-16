import { describe, it, expect } from "vitest";
import { syntheticVector, normalizeVector, cosineSimilarity } from "./index.js";

describe("AI utilities", () => {
  describe("normalizeVector", () => {
    it("should normalize a vector to unit length", () => {
      const vector = [1, 2, 2];
      const normalized = normalizeVector(vector);
      const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 7);
    });

    it("should handle zero vectors", () => {
      const vector = [0, 0, 0];
      const normalized = normalizeVector(vector);
      expect(normalized).toEqual([0, 0, 0]);
    });
  });

  describe("syntheticVector", () => {
    it("should generate a vector of the correct dimensions", () => {
      const vector = syntheticVector("test", 10);
      expect(vector.length).toBe(10);
    });

    it("should be deterministic", () => {
      const v1 = syntheticVector("test", 10);
      const v2 = syntheticVector("test", 10);
      expect(v1).toEqual(v2);
    });

    it("should be different for different inputs", () => {
      const v1 = syntheticVector("test1", 10);
      const v2 = syntheticVector("test2", 10);
      expect(v1).not.toEqual(v2);
    });
  });

  describe("cosineSimilarity", () => {
    it("should calculate similarity correctly", () => {
      const v1 = [1, 0];
      const v2 = [0, 1];
      const v3 = [1, 1];
      expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 7);
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 7);
      expect(cosineSimilarity(v1, v3)).toBeCloseTo(1 / Math.sqrt(2), 7);
    });
  });
});
