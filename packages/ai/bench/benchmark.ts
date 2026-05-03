
import { syntheticVector } from "../src/index.js";

const ITERATIONS = 1000;
const TEXT = "The quick brown fox jumps over the lazy dog";

console.log(`Benchmarking syntheticVector with ${ITERATIONS} iterations...`);

const start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  syntheticVector(TEXT);
}
const end = performance.now();

console.log(`Total time: ${(end - start).toFixed(2)}ms`);
console.log(`Average time: ${((end - start) / ITERATIONS).toFixed(4)}ms/op`);
