import crypto from "node:crypto";

import { selectEmbeddingModel } from "@jeanbot/model-router";
import { recordCounter, recordDuration } from "@jeanbot/telemetry";
import type { EmbeddingProvider, EmbeddingVectorRecord } from "@jeanbot/types";

const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_BATCH_SIZE = 32;
const MAX_CONCURRENCY = 3;
const MAX_RETRIES = 2;

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const contentHashFor = (value: string) => {
  const normalized = normalizeText(value);
  // Use faster single-shot hashing if available (Node 22+)
  // biome-ignore lint/suspicious/noExplicitAny: crypto.hash is new in Node 22
  if (typeof (crypto as any).hash === "function") {
    // biome-ignore lint/suspicious/noExplicitAny: crypto.hash is new in Node 22
    const hash = (crypto as any).hash("sha256", normalized);
    return typeof hash === "string" ? hash : Buffer.from(hash).toString("hex");
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

const seededUnitValue = (seed: string, index: number) => {
  const input = `${seed}:${index}`;
  let digest: Buffer;
  // biome-ignore lint/suspicious/noExplicitAny: crypto.hash is new in Node 22
  if (typeof (crypto as any).hash === "function") {
    // biome-ignore lint/suspicious/noExplicitAny: crypto.hash is new in Node 22
    digest = (crypto as any).hash("sha256", input, "buffer");
  } else {
    digest = crypto.createHash("sha256").update(input).digest();
  }
  const int = digest.readUInt32BE(0);
  return int / 0xffffffff;
};

const syntheticVector = (text: string, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) => {
  const normalized = normalizeText(text);
  const hash = contentHashFor(normalized);
  const values = new Array(dimensions);
  let sumSq = 0;

  for (let i = 0; i < dimensions; i++) {
    const centered = seededUnitValue(hash, i) * 2 - 1;
    // Faster precision limiting than toFixed(8)
    const val = Math.round(centered * 1e8) / 1e8;
    values[i] = val;
    sumSq += val * val;
  }

  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) {
    return values.fill(0);
  }

  for (let i = 0; i < dimensions; i++) {
    values[i] = Math.round((values[i] / magnitude) * 1e8) / 1e8;
  }

  return values;
};

const normalizeVector = (values: number[]) => {
  const len = values.length;
  if (len === 0) {
    return values;
  }

  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const val = values[i] ?? 0;
    sumSq += val * val;
  }

  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) {
    return new Array(len).fill(0);
  }

  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = Math.round(((values[i] ?? 0) / magnitude) * 1e8) / 1e8;
  }

  return result;
};

const toEmbeddingVectorRecord = (
  text: string,
  values: number[],
  provider: EmbeddingProvider,
  model: string
): EmbeddingVectorRecord => ({
  values: normalizeVector(values),
  dimensions: values.length,
  provider,
  model,
  generatedAt: new Date().toISOString(),
  contentHash: contentHashFor(text)
});

const sleep = (timeMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, timeMs);
  });

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const runBounded = async <TInput, TOutput>(
  values: TInput[],
  limit: number,
  task: (value: TInput, index: number) => Promise<TOutput>
) => {
  const results: TOutput[] = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({
    length: Math.max(1, Math.min(limit, values.length))
  }, async () => {
    while (nextIndex < values.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await task(values[current], current);
    }
  });

  await Promise.all(workers);
  return results;
};

const callOpenAiEmbeddings = async (
  inputs: string[],
  apiKey: string,
  model: string
) => {
  const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: inputs
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      embedding?: number[];
      index?: number;
    }>;
  };

  const data = payload.data ?? [];
  return data
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((record) => normalizeVector(record.embedding ?? []));
};

const embedBatchLive = async (
  inputs: string[],
  apiKey: string,
  model: string,
  retries = MAX_RETRIES
) => {
  const startedAt = Date.now();
  try {
    const vectors = await callOpenAiEmbeddings(inputs, apiKey, model);
    recordCounter("jeanbot_embeddings_requests_total", "JeanBot embedding requests", {
      provider: "openai",
      status: "ok"
    });
    recordDuration(
      "jeanbot_embeddings_request_duration_ms",
      "JeanBot embedding request duration",
      Date.now() - startedAt,
      {
        provider: "openai"
      }
    );
    return vectors;
  } catch (error) {
    recordCounter("jeanbot_embeddings_requests_total", "JeanBot embedding requests", {
      provider: "openai",
      status: "failed"
    });
    if (retries <= 0) {
      throw error;
    }

    await sleep((MAX_RETRIES - retries + 1) * 250);
    return embedBatchLive(inputs, apiKey, model, retries - 1);
  }
};

export interface EmbeddingGenerationOptions {
  forceSynthetic?: boolean | undefined;
}

export const embeddingDimensions = DEFAULT_EMBEDDING_DIMENSIONS;

export const embeddingRuntimeStatus = () => {
  const selection = selectEmbeddingModel();
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return {
    provider: configured ? "openai" : "synthetic",
    configured,
    model: selection.model,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS
  };
};

export const generateEmbeddings = async (
  inputs: string[],
  options: EmbeddingGenerationOptions = {}
) => {
  const selection = selectEmbeddingModel();
  const normalizedInputs = inputs.map((input) => normalizeText(input));
  const useLive = Boolean(process.env.OPENAI_API_KEY) && !options.forceSynthetic;
  const provider: EmbeddingProvider = useLive ? "openai" : "synthetic";

  if (!useLive) {
    return normalizedInputs.map((input) =>
      toEmbeddingVectorRecord(input, syntheticVector(input), provider, selection.model)
    );
  }

  const batches = chunk(normalizedInputs, OPENAI_BATCH_SIZE);
  const batchedVectors = await runBounded(batches, MAX_CONCURRENCY, async (batch) =>
    embedBatchLive(batch, String(process.env.OPENAI_API_KEY), selection.model)
  );

  return batchedVectors
    .flat()
    .map((values, index) =>
      toEmbeddingVectorRecord(normalizedInputs[index], values, provider, selection.model)
    );
};

export const generateEmbedding = async (
  input: string,
  options: EmbeddingGenerationOptions = {}
) => {
  const [record] = await generateEmbeddings([input], options);
  return record;
};

export const cosineSimilarity = (left: number[] | undefined, right: number[] | undefined) => {
  if (!left || !right) {
    return 0;
  }

  const len = left.length;
  if (len === 0 || len !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < len; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

export const normalizeEmbeddingText = normalizeText;
export const embeddingContentHash = contentHashFor;
