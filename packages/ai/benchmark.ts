import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { cosineSimilarity, generateEmbeddings } from "./src/index.js";

const ITERATIONS = 100000;
const DIMENSIONS = 1536;

async function runBenchmarks() {
  console.log("Starting benchmarks...");

  const v1 = Array.from({ length: DIMENSIONS }, () => Math.random());
  const v2 = Array.from({ length: DIMENSIONS }, () => Math.random());

  // Cosine Similarity Benchmark
  for (let i = 0; i < 10000; i++) cosineSimilarity(v1, v2);
  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) cosineSimilarity(v1, v2);
  let end = performance.now();
  console.log(`Cosine Similarity (${ITERATIONS} ops): ${(end - start).toFixed(2)}ms (${((end - start) / ITERATIONS).toFixed(6)}ms/op)`);

  const text = "This is a test sentence for benchmarking synthetic vector generation performance.";

  // Synthetic Vector Benchmark
  for (let i = 0; i < 10; i++) await generateEmbeddings([text], { forceSynthetic: true });
  start = performance.now();
  const synthIterations = 100;
  for (let i = 0; i < synthIterations; i++) await generateEmbeddings([text], { forceSynthetic: true });
  end = performance.now();
  console.log(`Synthetic Embedding (${synthIterations} ops): ${(end - start).toFixed(2)}ms (${((end - start) / synthIterations).toFixed(6)}ms/op)`);
}

runBenchmarks().catch(console.error);
