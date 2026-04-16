import { describe, it, expect } from 'vitest';
import { generateEmbedding, cosineSimilarity } from './index.js';

describe('AI package', () => {
  it('generates synthetic embeddings', async () => {
    const embedding = await generateEmbedding('hello world', { forceSynthetic: true });
    expect(embedding.values).toHaveLength(1536);
    expect(embedding.provider).toBe('synthetic');

    // Check normalization
    const magnitude = Math.sqrt(embedding.values.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('calculates cosine similarity correctly', () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0, 5);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1, 5);
  });
});
