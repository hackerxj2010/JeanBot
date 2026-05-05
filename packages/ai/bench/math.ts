
import { performance } from 'node:perf_hooks';

const iterations = 1000000;
const value = 0.123456789;

function benchToFixed() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    Number(value.toFixed(8));
  }
  return performance.now() - start;
}

function benchMath() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    Math.round(value * 1e8) / 1e8;
  }
  return performance.now() - start;
}

console.log(`toFixed: ${benchToFixed().toFixed(2)}ms`);
console.log(`Math.round: ${benchMath().toFixed(2)}ms`);
