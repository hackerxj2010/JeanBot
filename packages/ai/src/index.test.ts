
import { describe, it, expect } from 'vitest';
import { syntheticVector, normalizeVector, cosineSimilarity } from './index';

describe('AI Package', () => {
  it('should generate synthetic vectors of correct dimension', () => {
    const dimensions = 10;
    const vector = syntheticVector('test', dimensions);
    expect(vector).toHaveLength(dimensions);
  });

  it('should generate consistent synthetic vectors', () => {
    const v1 = syntheticVector('test', 10);
    const v2 = syntheticVector('test', 10);
    expect(v1).toEqual(v2);
  });

  it('should generate different vectors for different text', () => {
    const v1 = syntheticVector('test1', 10);
    const v2 = syntheticVector('test2', 10);
    expect(v1).not.toEqual(v2);
  });

  it('should normalize vectors correctly', () => {
    const vector = [1, 2, 2]; // Magnitude is 3
    const normalized = normalizeVector(vector);
    expect(normalized[0]).toBeCloseTo(1/3, 8);
    expect(normalized[1]).toBeCloseTo(2/3, 8);
    expect(normalized[2]).toBeCloseTo(2/3, 8);

    // Check magnitude of normalized vector is 1
    const magnitude = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 7);
  });

  it('should handle zero magnitude vectors in normalization', () => {
    const vector = [0, 0, 0];
    const normalized = normalizeVector(vector);
    expect(normalized).toEqual([0, 0, 0]);
  });

  it('should calculate cosine similarity correctly', () => {
    const v1 = [1, 0];
    const v2 = [0, 1];
    const v3 = [1, 1];

    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 8);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 8);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(1 / Math.sqrt(2), 8);
  });
});
