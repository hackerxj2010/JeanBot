import { performance } from "node:perf_hooks";
import { syntheticVector, cosineSimilarity } from "./src/index.ts";

const ITERATIONS = 100;
const DIMENSIONS = 1536;
const TEXT = "Hello, Bolt! This is a test of the synthetic vector generation performance.";

async function runBenchmark() {
  console.log(`Running benchmark with ${ITERATIONS} iterations...`);

  // Warmup
  syntheticVector(TEXT, DIMENSIONS);

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    syntheticVector(TEXT, DIMENSIONS);
  }
  const end = performance.now();

  const avgTime = (end - start) / ITERATIONS;
  console.log(`Average time for syntheticVector: ${avgTime.toFixed(4)}ms`);

  const v1 = syntheticVector("text 1", DIMENSIONS);
  const v2 = syntheticVector("text 2", DIMENSIONS);

  const startCos = performance.now();
  for (let i = 0; i < 10000; i++) {
    cosineSimilarity(v1, v2);
  }
  const endCos = performance.now();
  console.log(`Average time for cosineSimilarity (10k iterations): ${(endCos - startCos).toFixed(4)}ms`);
}

runBenchmark().catch(console.error);
