
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';

// Original implementation snippets
const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
const contentHashFor_OLD = (value: string) =>
  crypto.createHash("sha256").update(normalizeText(value)).digest("hex");

const seededUnitValue_OLD = (seed: string, index: number) => {
  const digest = crypto.createHash("sha256").update(`${seed}:${index}`).digest();
  const int = digest.readUInt32BE(0);
  return int / 0xffffffff;
};

const normalizeVector_OLD = (values: number[]) => {
  if (values.length === 0) {
    return values;
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => Number((value / magnitude).toFixed(8)));
};

const syntheticVector_OLD = (text: string, dimensions = 1536) => {
  const normalized = normalizeText(text);
  const hash = contentHashFor_OLD(normalized);
  const values = Array.from({
    length: dimensions
  }, (_, index) => {
    const centered = seededUnitValue_OLD(hash, index) * 2 - 1;
    return Number(centered.toFixed(8));
  });
  return normalizeVector_OLD(values);
};

// Optimized implementation snippets
const contentHashFor_NEW = (value: string) => {
  if (typeof (crypto as any).hash === 'function') {
    return (crypto as any).hash("sha256", normalizeText(value), "hex");
  }
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex");
};

const seededUnitValue_NEW = (seed: string, index: number) => {
  let digest: Buffer;
  const input = `${seed}:${index}`;
  if (typeof (crypto as any).hash === 'function') {
    digest = (crypto as any).hash("sha256", input, "buffer");
  } else {
    digest = crypto.createHash("sha256").update(input).digest();
  }
  const int = digest.readUInt32BE(0);
  return int / 0xffffffff;
};

const normalizeVector_NEW = (values: number[]) => {
  if (values.length === 0) {
    return values;
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return values.map(() => 0);
  }
  const factor = 1 / magnitude;
  return values.map((value) => Math.round((value * factor) * 1e8) / 1e8);
};

const syntheticVector_NEW = (text: string, dimensions = 1536) => {
  const normalized = normalizeText(text);
  const hash = contentHashFor_NEW(normalized);

  // Use for loop for better performance than Array.from
  const values = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    const centered = seededUnitValue_NEW(hash, i) * 2 - 1;
    values[i] = Math.round(centered * 1e8) / 1e8;
  }
  return normalizeVector_NEW(values);
};

const iterations = 100;
const testText = "Analyze this text for synthetic embedding generation performance.";

function benchOld() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    syntheticVector_OLD(testText);
  }
  return performance.now() - start;
}

function benchNew() {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    syntheticVector_NEW(testText);
  }
  return performance.now() - start;
}

// Warm up
syntheticVector_OLD(testText);
syntheticVector_NEW(testText);

console.log(`syntheticVector (OLD): ${benchOld().toFixed(2)}ms for ${iterations} ops`);
console.log(`syntheticVector (NEW): ${benchNew().toFixed(2)}ms for ${iterations} ops`);

// Verify equality (within precision)
const vOld = syntheticVector_OLD(testText);
const vNew = syntheticVector_NEW(testText);
let diff = 0;
for(let i=0; i<vOld.length; i++) {
    diff += Math.abs(vOld[i] - vNew[i]);
}
console.log(`Total difference: ${diff}`);
