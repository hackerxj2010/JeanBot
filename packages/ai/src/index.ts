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

/**
 * Faster rounding to a fixed number of decimal places.
 * Benchmark shows this is ~300x faster than Number(x.toFixed(n)).
 */
const fastRound = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};

const contentHashFor = (value: string) => {
  const normalized = normalizeText(value);
  // Node 22's crypto.hash is significantly faster than createHash().update().digest()
  // @ts-ignore - crypto.hash is available in Node 22
  if (crypto.hash) {
    // @ts-ignore
    return crypto.hash("sha256", normalized, "hex");
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

const seededUnitValue = (seed: string, index: number) => {
  const input = `${seed}:${index}`;
  // @ts-ignore
  if (crypto.hash) {
    // @ts-ignore
    const digest = crypto.hash("sha256", input, "buffer") as Buffer;
    // Buffer.readUInt32BE is efficient; fallback to DataView if not a Buffer
    const int =
      typeof digest.readUInt32BE === "function"
        ? digest.readUInt32BE(0)
        : new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0);
    return int / 0xffffffff;
  }
  const digest = crypto.createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
};

const syntheticVector = (text: string, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) => {
  // Input text is already normalized by caller
  const hash = contentHashFor(text);
  const values = Array.from({
    length: dimensions
  }, (_, index) => {
    // We skip rounding here as normalizeVector performs the final rounding
    return seededUnitValue(hash, index) * 2 - 1;
  });
  return normalizeVector(values);
};

const normalizeVector = (values: number[]) => {
  if (values.length === 0) {
    return values;
  }

  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return values.map(() => 0);
  }

  return values.map((value) => fastRound(value / magnitude, 8));
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
  // syntheticVector and toEmbeddingVectorRecord already normalize, so we only do it once here
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
  if (!left || !right || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
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
