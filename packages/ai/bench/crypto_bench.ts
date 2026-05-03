
import crypto from "node:crypto";

const ITERATIONS = 100000;
const TEXT = "The quick brown fox jumps over the lazy dog";

console.log(`Benchmarking crypto performance with ${ITERATIONS} iterations...`);

const startOld = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  crypto.createHash("sha256").update(TEXT).digest("hex");
}
const endOld = performance.now();
console.log(`crypto.createHash: ${(endOld - startOld).toFixed(2)}ms (${((endOld - startOld) / ITERATIONS).toFixed(4)}ms/op)`);

const startNew = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  (crypto as any).hash("sha256", TEXT, "hex");
}
const endNew = performance.now();
console.log(`crypto.hash: ${(endNew - startNew).toFixed(2)}ms (${((endNew - startNew) / ITERATIONS).toFixed(4)}ms/op)`);
