import { generateEmbedding, cosineSimilarity } from "./src/index.js";

async function main() {
  console.log("Starting benchmark...");
  const text = "The quick brown fox jumps over the lazy dog";

  // Warm up
  await generateEmbedding(text);

  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await generateEmbedding(text, { forceSynthetic: true });
  }
  const end = performance.now();
  console.log(`Synthetic embedding generation: ${((end - start) / iterations).toFixed(4)}ms/op`);

  const v1 = (await generateEmbedding(text, { forceSynthetic: true })).values;
  const v2 = (await generateEmbedding("The lazy dog is jumped over by the quick brown fox", { forceSynthetic: true })).values;

  const startSim = performance.now();
  for (let i = 0; i < iterations * 10; i++) {
    cosineSimilarity(v1, v2);
  }
  const endSim = performance.now();
  console.log(`Cosine similarity: ${((endSim - startSim) / (iterations * 10)).toFixed(5)}ms/op`);

  console.log(`Similarity score: ${cosineSimilarity(v1, v2).toFixed(4)}`);
}

main().catch(console.error);
