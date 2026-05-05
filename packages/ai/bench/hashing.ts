
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';

const iterations = 10000;
const input = "This is a test string for hashing performance comparison.";

function benchCreateHash() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    crypto.createHash('sha256').update(input).digest('hex');
  }
  return performance.now() - start;
}

function benchHash() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    (crypto as any).hash('sha256', input, 'hex');
  }
  return performance.now() - start;
}

console.log(`crypto.createHash: ${benchCreateHash().toFixed(2)}ms`);
console.log(`crypto.hash: ${benchHash().toFixed(2)}ms`);
