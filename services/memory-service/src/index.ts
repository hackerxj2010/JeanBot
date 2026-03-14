import crypto from "node:crypto";

import Fastify from "fastify";

import {
  embeddingContentHash,
  embeddingRuntimeStatus,
  generateEmbedding
} from "@jeanbot/ai";
import { TtlCache } from "@jeanbot/cache";
import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  assertInternalRequest,
  assertWorkspaceAccess,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import type {
  MemoryRecord,
  SemanticSearchResponse,
  SemanticSearchResult,
  ServiceHealth
} from "@jeanbot/types";

import { EntityGraph } from "./entity-graph/entity-graph.js";
import { LongTermMemoryStore } from "./long-term-memory/long-term-store.js";
import { SessionMemoryStore } from "./session-memory/session-store.js";

const MAX_SEARCH_RESULTS = 8;
const MAX_INJECT_RESULTS = 5;

const excerptFor = (value: string, maxLength = 280) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const recencyScore = (createdAt: string) => {
  const ageMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays / 14);
};

const importanceScore = (importance: number | undefined) =>
  Math.max(0, Math.min(1, importance ?? 0.5));

const mergedScore = (similarity: number, createdAt: string, importance: number | undefined) => {
  const recency = recencyScore(createdAt);
  const importanceValue = importanceScore(importance);
  return {
    similarity,
    recency,
    importance: importanceValue,
    score: similarity * 0.65 + recency * 0.2 + importanceValue * 0.15
  };
};

const toMemorySearchResult = (
  record: MemoryRecord,
  similarity: number
): SemanticSearchResult => ({
  id: record.id,
  workspaceId: record.workspaceId,
  sourceKind: "memory",
  text: record.text,
  excerpt: excerptFor(record.text),
  tags: record.tags,
  metadata: {
    scope: record.scope
  },
  createdAt: record.createdAt,
  importance: importanceScore(record.importance),
  similarity,
  embeddingModel: record.embeddingModel,
  contentHash: record.contentHash,
  score: mergedScore(similarity, record.createdAt, record.importance)
});

const toKnowledgeSearchResult = (
  document: {
    id: string;
    workspaceId: string;
    title: string;
    body: string;
    excerpt: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    contentHash: string;
    embeddingModel?: string | undefined;
  },
  similarity: number
): SemanticSearchResult => ({
  id: document.id,
  workspaceId: document.workspaceId,
  sourceKind: "knowledge",
  title: document.title,
  text: document.body,
  excerpt: document.excerpt,
  tags: [],
  metadata: document.metadata,
  createdAt: document.createdAt,
  importance: importanceScore(
    typeof document.metadata.importance === "number"
      ? (document.metadata.importance as number)
      : 0.6
  ),
  similarity,
  embeddingModel: document.embeddingModel,
  contentHash: document.contentHash,
  score: mergedScore(
    similarity,
    document.createdAt,
    typeof document.metadata.importance === "number"
      ? (document.metadata.importance as number)
      : 0.6
  )
});

export class MemoryService {
  private readonly logger = createLogger("memory-service");
  private readonly sessionMemory = new SessionMemoryStore();
  private readonly longTermMemory = new LongTermMemoryStore();
  private readonly workspaceSummaryCache = new TtlCache<string>();
  private readonly entityGraph = new EntityGraph();
  private readonly persistence = createPersistenceBundle();
  private readonly loadedWorkspaces = new Set<string>();

  private async ensureLoaded(workspaceId: string) {
    if (this.loadedWorkspaces.has(workspaceId)) {
      return;
    }

    const records = await this.persistence.memory.list(workspaceId);
    this.sessionMemory.replace(
      workspaceId,
      records.filter((record) => record.scope === "session" || record.scope === "short-term")
    );
    this.longTermMemory.replace(
      workspaceId,
      records.filter((record) => record.scope === "long-term" || record.scope === "structured")
    );
    this.loadedWorkspaces.add(workspaceId);
  }

  private async persist(workspaceId: string) {
    const allRecords = [
      ...this.sessionMemory.list(workspaceId),
      ...this.longTermMemory.list(workspaceId)
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    await this.persistence.memory.save(workspaceId, allRecords);
    return allRecords;
  }

  private async buildEmbeddedRecord(
    workspaceId: string,
    text: string,
    tags: string[],
    scope: MemoryRecord["scope"],
    importance: number
  ) {
    const createdAt = new Date().toISOString();
    const contentHash = embeddingContentHash(text);
    const shouldEmbed = scope === "long-term" || scope === "structured";
    const vector = shouldEmbed ? await generateEmbedding(text) : undefined;

    return {
      id: crypto.randomUUID(),
      workspaceId,
      text,
      tags,
      scope,
      importance,
      contentHash,
      embedding: vector?.values,
      embeddingModel: vector?.model,
      embeddingUpdatedAt: vector?.generatedAt,
      createdAt
    } satisfies MemoryRecord;
  }

  async remember(
    workspaceId: string,
    text: string,
    tags: string[] = [],
    scope: MemoryRecord["scope"] = "short-term",
    importance = 0.5
  ) {
    await this.ensureLoaded(workspaceId);
    const record = await this.buildEmbeddedRecord(workspaceId, text, tags, scope, importance);

    if (scope === "session" || scope === "short-term") {
      this.sessionMemory.add(record);
    } else {
      this.longTermMemory.add(record);
    }

    this.workspaceSummaryCache.delete(workspaceId);
    await this.persist(workspaceId);
    this.logger.info("Stored memory", { workspaceId, scope, tags });
    return record;
  }

  async promoteSummary(input: {
    workspaceId: string;
    text: string;
    tags?: string[] | undefined;
    importance?: number | undefined;
  }) {
    return this.remember(
      input.workspaceId,
      input.text,
      ["summary", "promoted", ...(input.tags ?? [])],
      "long-term",
      input.importance ?? 0.8
    );
  }

  async recall(workspaceId: string, query = "") {
    await this.ensureLoaded(workspaceId);
    const records = [
      ...this.sessionMemory.list(workspaceId),
      ...this.longTermMemory.list(workspaceId)
    ];

    if (!query.trim()) {
      return records;
    }

    const search = await this.semanticSearch(workspaceId, query, {
      limit: MAX_SEARCH_RESULTS,
      injectLimit: MAX_INJECT_RESULTS,
      sourceKinds: ["memory"]
    });

    const byId = new Map(records.map((record) => [record.id, record]));
    return search.results
      .map((result) => byId.get(result.id))
      .filter((record): record is MemoryRecord => Boolean(record));
  }

  async semanticSearch(
    workspaceId: string,
    query: string,
    options: {
      limit?: number | undefined;
      injectLimit?: number | undefined;
      sourceKinds?: Array<"memory" | "knowledge"> | undefined;
    } = {}
  ): Promise<SemanticSearchResponse> {
    await this.ensureLoaded(workspaceId);
    const limit = options.limit ?? MAX_SEARCH_RESULTS;
    const injectLimit = options.injectLimit ?? MAX_INJECT_RESULTS;
    const sourceKinds = new Set(options.sourceKinds ?? ["memory", "knowledge"]);
    const queryEmbedding = await generateEmbedding(query);
    const [memoryMatches, knowledgeMatches] = await Promise.all([
      sourceKinds.has("memory")
        ? this.persistence.memory.search(workspaceId, queryEmbedding.values, limit * 2)
        : Promise.resolve([]),
      sourceKinds.has("knowledge")
        ? this.persistence.knowledge.search(workspaceId, queryEmbedding.values, limit * 2)
        : Promise.resolve([])
    ]);

    const merged = [
      ...memoryMatches.map((match) => toMemorySearchResult(match.record, match.similarity)),
      ...knowledgeMatches.map((match) => toKnowledgeSearchResult(match.document, match.similarity))
    ]
      .sort((left, right) => right.score.score - left.score.score)
      .slice(0, limit);

    return {
      workspaceId,
      query,
      generatedAt: new Date().toISOString(),
      results: merged,
      injectedResults: merged.slice(0, injectLimit)
    };
  }

  async forget(workspaceId: string, memoryId: string) {
    await this.ensureLoaded(workspaceId);
    const session = this.sessionMemory.list(workspaceId).filter((record) => record.id !== memoryId);
    const longTerm = this.longTermMemory.list(workspaceId).filter((record) => record.id !== memoryId);
    this.sessionMemory.replace(workspaceId, session);
    this.longTermMemory.replace(workspaceId, longTerm);
    this.workspaceSummaryCache.delete(workspaceId);
    await this.persist(workspaceId);
  }

  async summarizeWorkspace(workspaceId: string) {
    const cached = this.workspaceSummaryCache.get(workspaceId);
    if (cached) {
      return cached;
    }

    const records = await this.recall(workspaceId);
    const summary =
      records.length === 0
        ? "No memory stored yet."
        : records
            .sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0))
            .slice(0, 7)
            .map((record) => `- [${record.scope}] ${excerptFor(record.text, 180)}`)
            .join("\n");

    this.workspaceSummaryCache.set(workspaceId, summary, 60_000);
    return summary;
  }

  linkEntity(left: string, right: string) {
    this.entityGraph.link(left, right);
  }

  relatedEntities(entity: string) {
    return this.entityGraph.neighbors(entity);
  }

  health(): ServiceHealth {
    const embeddingStatus = embeddingRuntimeStatus();
    return {
      name: "memory-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode,
        embeddingProvider: embeddingStatus.provider,
        embeddingModel: embeddingStatus.model
      },
      readiness: {
        persistence: {
          ok: true,
          status: "ready",
          message: `Memory persistence is running in ${this.persistence.mode} mode.`
        },
        embeddings: {
          ok: true,
          status: embeddingStatus.configured ? "ready" : "degraded",
          message: embeddingStatus.configured
            ? "Live embeddings are enabled."
            : "Synthetic embeddings are active because OPENAI_API_KEY is not configured."
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildMemoryServiceApp = () => {
  const app = Fastify();
  const service = new MemoryService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("memory-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "memory-service",
      method: request.method,
      route,
      status: String(reply.statusCode)
    };
    recordCounter("jeanbot_http_server_requests_total", "JeanBot HTTP server requests", labels);
    recordDuration(
      "jeanbot_http_server_request_duration_ms",
      "JeanBot HTTP server request duration",
      Date.now() - startedAt,
      labels
    );
  });

  app.addHook("onError", async (request, _reply, error) => {
    captureException(error, {
      service: "memory-service",
      route: request.routeOptions.url ?? request.url.split("?")[0]
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics();
  });

  app.get("/internal/memory/workspaces/:workspaceId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.recall(params.workspaceId);
  });

  app.post("/internal/memory/workspaces/:workspaceId/remember", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      text: string;
      tags?: string[];
      scope?: MemoryRecord["scope"];
      importance?: number;
    };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.remember(
      params.workspaceId,
      body.text,
      body.tags ?? [],
      body.scope ?? "short-term",
      body.importance ?? 0.5
    );
  });

  app.post("/internal/memory/workspaces/:workspaceId/promote", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      text: string;
      tags?: string[];
      importance?: number;
    };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.promoteSummary({
      workspaceId: params.workspaceId,
      text: body.text,
      tags: body.tags,
      importance: body.importance
    });
  });

  app.post("/internal/memory/workspaces/:workspaceId/search", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as {
      query: string;
      limit?: number;
      injectLimit?: number;
      sourceKinds?: Array<"memory" | "knowledge">;
    };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.semanticSearch(params.workspaceId, body.query, {
      limit: body.limit,
      injectLimit: body.injectLimit,
      sourceKinds: body.sourceKinds
    });
  });

  app.get("/internal/memory/workspaces/:workspaceId/summary", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return {
      workspaceId: params.workspaceId,
      summary: await service.summarizeWorkspace(params.workspaceId)
    };
  });

  app.delete("/internal/memory/workspaces/:workspaceId/:memoryId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string; memoryId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    await service.forget(params.workspaceId, params.memoryId);
    return {
      ok: true
    };
  });

  return {
    app,
    service
  };
};
