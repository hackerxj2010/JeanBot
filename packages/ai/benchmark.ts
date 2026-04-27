import { performance } from "node:perf_hooks";
import { cosineSimilarity, generateEmbeddings } from "./src/index.js";

async function runBenchmark() {
  console.log("Starting AI performance benchmark...");

  // Benchmark Cosine Similarity
  const v1 = Array.from({ length: 1536 }, () => Math.random());
  const v2 = Array.from({ length: 1536 }, () => Math.random());

  const iterations = 100000;
  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    cosineSimilarity(v1, v2);
  }
  let end = performance.now();
  console.log(`Cosine Similarity: ${(end - start).toFixed(4)}ms for ${iterations} ops (${((end - start) / iterations).toFixed(6)}ms/op)`);

  // Benchmark Synthetic Embedding Generation
  const inputs = Array.from({ length: 100 }, (_, i) => `Sample text for embedding generation iteration ${i}`);
  start = performance.now();
  await generateEmbeddings(inputs, { forceSynthetic: true });
  end = performance.now();
  console.log(`Synthetic Embeddings (100 items): ${(end - start).toFixed(4)}ms (${((end - start) / 100).toFixed(4)}ms/item)`);
}

runBenchmark().catch(console.error);
