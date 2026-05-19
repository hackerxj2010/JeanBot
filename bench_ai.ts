import { generateEmbeddings } from './packages/ai/src/index.ts';

async function runBenchmark() {
  const inputs = Array.from({ length: 50 }, (_, i) => `This is a test input sentence number ${i} for synthetic embedding generation benchmark.`);

  // Warmup
  await generateEmbeddings(inputs.slice(0, 5), { forceSynthetic: true });

  console.time('synthetic_embedding_batch');
  for (let i = 0; i < 10; i++) {
    await generateEmbeddings(inputs, { forceSynthetic: true });
  }
  console.timeEnd('synthetic_embedding_batch');
}

runBenchmark().catch(console.error);
