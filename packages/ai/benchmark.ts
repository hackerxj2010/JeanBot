import { performance } from "node:perf_hooks";
import { cosineSimilarity, generateEmbeddings, syntheticVector, normalizeVector } from "./src/index.ts";

const ITERATIONS = 1000;
const DIMENSIONS = 1536;

const runBenchmark = async () => {
  console.log("Starting JeanBot AI Benchmarks...");
  console.log(`Dimensions: ${DIMENSIONS}`);
  console.log(`Iterations: ${ITERATIONS}`);

  // 1. Synthetic Vector Generation
  const startSynthetic = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    syntheticVector(`Benchmark text iteration ${i}`, DIMENSIONS);
  }
  const endSynthetic = performance.now();
  console.log(`\nSynthetic Vector Generation: ${((endSynthetic - startSynthetic) / ITERATIONS).toFixed(4)}ms per op`);

  // 2. Vector Normalization
  const mockVector = Array.from({ length: DIMENSIONS }, () => Math.random());
  const startNormalize = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    normalizeVector(mockVector);
  }
  const endNormalize = performance.now();
  console.log(`Vector Normalization: ${((endNormalize - startNormalize) / ITERATIONS).toFixed(4)}ms per op`);

  // 3. Cosine Similarity
  const v1 = normalizeVector(Array.from({ length: DIMENSIONS }, () => Math.random()));
  const v2 = normalizeVector(Array.from({ length: DIMENSIONS }, () => Math.random()));
  const startCosine = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    cosineSimilarity(v1, v2);
  }
  const endCosine = performance.now();
  console.log(`Cosine Similarity: ${((endCosine - startCosine) / ITERATIONS).toFixed(4)}ms per op`);

  // 4. Batch Embedding Generation (Synthetic)
  const inputs = Array.from({ length: 10 }, (_, i) => `Sample text for embedding ${i}`);
  const startBatch = performance.now();
  for (let i = 0; i < 100; i++) {
    await generateEmbeddings(inputs, { forceSynthetic: true });
  }
  const endBatch = performance.now();
  console.log(`Batch Embedding (10 items): ${((endBatch - startBatch) / 100).toFixed(4)}ms per op`);
};

runBenchmark().catch(console.error);
