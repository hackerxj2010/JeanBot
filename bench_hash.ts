
import crypto from "node:crypto";

const iterations = 10000;
const input = "some-input-string-to-hash";

console.time("createHash");
for (let i = 0; i < iterations; i++) {
  crypto.createHash("sha256").update(input).digest();
}
console.timeEnd("createHash");

console.time("hash");
for (let i = 0; i < iterations; i++) {
  // @ts-ignore - crypto.hash is available in Node 22
  crypto.hash("sha256", input);
}
console.timeEnd("hash");
