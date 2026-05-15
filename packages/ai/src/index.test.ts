
import { describe, it, expect } from 'vitest';
import { syntheticVector, normalizeVector, cosineSimilarity } from './index';

describe('AI package', () => {
  it('should generate synthetic vectors of correct dimension', () => {
    const vector = syntheticVector('hello', 1536);
    expect(vector).toHaveLength(1536);
  });

  it('should generate consistent vectors for the same input', () => {
    const v1 = syntheticVector('hello', 128);
    const v2 = syntheticVector('hello', 128);
    expect(v1).toEqual(v2);
  });

  it('should generate different vectors for different inputs', () => {
    const v1 = syntheticVector('hello', 128);
    const v2 = syntheticVector('world', 128);
    expect(v1).not.toEqual(v2);
  });

  it('should normalize vectors correctly', () => {
    const v = [1, 1, 1, 1];
    const normalized = normalizeVector(v);
    const magnitude = Math.sqrt(normalized.reduce((sum, val) => sum + val * val, 0));
    expect(magnitude).toBeCloseTo(1, 8);
  });

  it('should handle zero magnitude vectors', () => {
    const v = [0, 0, 0];
    const normalized = normalizeVector(v);
    expect(normalized).toEqual([0, 0, 0]);
  });

  it('should calculate cosine similarity correctly', () => {
    const v1 = [1, 0];
    const v2 = [0, 1];
    const v3 = [1, 0];
    expect(cosineSimilarity(v1, v2)).toBe(0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1, 8);
  });
});
