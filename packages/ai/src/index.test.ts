
import { describe, it, expect } from 'vitest';
import {
  normalizeEmbeddingText,
  embeddingContentHash,
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddings
} from './index.js';

describe('@jeanbot/ai', () => {
  it('should normalize text correctly', () => {
    expect(normalizeEmbeddingText('  hello   world  ')).toBe('hello world');
  });

  it('should generate consistent hashes', () => {
    const hash1 = embeddingContentHash('hello world');
    const hash2 = embeddingContentHash('  hello world  ');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should calculate cosine similarity correctly', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const v3 = [1, 1, 0];

    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1);
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(Math.sqrt(0.5));
  });

  it('should generate synthetic embeddings when no API key is present', async () => {
    const text = "test message";
    const embedding = await generateEmbedding(text, { forceSynthetic: true });

    expect(embedding.values).toHaveLength(1536);
    expect(embedding.provider).toBe('synthetic');

    // Check normalization (magnitude should be ~1)
    const magnitude = Math.sqrt(embedding.values.reduce((sum: number, v: number) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('should generate multiple synthetic embeddings', async () => {
    const texts = ["hello", "world"];
    const embeddings = await generateEmbeddings(texts, { forceSynthetic: true });

    expect(embeddings).toHaveLength(2);
    expect(embeddings[0].values).toHaveLength(1536);
    expect(embeddings[1].values).toHaveLength(1536);
  });
});
