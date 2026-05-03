
const ITERATIONS = 1000000;

console.log(`Benchmarking precision math performance with ${ITERATIONS} iterations...`);

const values = Array.from({ length: 1000 }, () => Math.random() * 2 - 1);

const startOld = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const v = values[i % 1000];
  Number(v.toFixed(8));
}
const endOld = performance.now();
console.log(`Number(v.toFixed(8)): ${(endOld - startOld).toFixed(2)}ms (${((endOld - startOld) / ITERATIONS).toFixed(4)}ms/op)`);

const startNew = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const v = values[i % 1000];
  Math.round(v * 1e8) / 1e8;
}
const endNew = performance.now();
console.log(`Math.round(v * 1e8) / 1e8: ${(endNew - startNew).toFixed(2)}ms (${((endNew - startNew) / ITERATIONS).toFixed(4)}ms/op)`);
