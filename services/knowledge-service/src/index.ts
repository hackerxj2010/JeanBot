import crypto from "node:crypto";

import Fastify from "fastify";

import {
  embeddingContentHash,
  embeddingRuntimeStatus,
  generateEmbedding
} from "@jeanbot/ai";
import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  assertInternalRequest,
  assertWorkspaceAccess,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import type {
  KnowledgeDocumentRecord,
  SemanticSearchResponse,
  SemanticSearchResult,
  ServiceHealth
} from "@jeanbot/types";

const excerptFor = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 240);

const recencyScore = (createdAt: string) => {
  const ageMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays / 14);
};

const importanceScore = (metadata: Record<string, unknown>) =>
  typeof metadata.importance === "number" ? Math.max(0, Math.min(1, metadata.importance)) : 0.6;

const toSearchResult = (
  document: KnowledgeDocumentRecord,
  similarity: number
): SemanticSearchResult => {
  const importance = importanceScore(document.metadata);
  const recency = recencyScore(document.createdAt);
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    sourceKind: "knowledge",
    title: document.title,
    text: document.body,
    excerpt: document.excerpt,
    tags: [],
    metadata: document.metadata,
    createdAt: document.createdAt,
    importance,
    similarity,
    embeddingModel: document.embeddingModel,
    contentHash: document.contentHash,
    score: {
      similarity,
      recency,
      importance,
      score: similarity * 0.65 + recency * 0.2 + importance * 0.15
    }
  };
};

export class KnowledgeService {
  private readonly logger = createLogger("knowledge-service");
  private readonly persistence = createPersistenceBundle();

  async ingest(input: {
    workspaceId: string;
    title: string;
    body: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const embedding = await generateEmbedding(`${input.title}\n${input.body}`);
    const document: KnowledgeDocumentRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      title: input.title,
      body: input.body,
      metadata: input.metadata ?? {},
      contentHash: embeddingContentHash(input.body),
      excerpt: excerptFor(input.body),
      embedding: embedding.values,
      embeddingModel: embedding.model,
      embeddingUpdatedAt: embedding.generatedAt,
      createdAt: new Date().toISOString()
    };

    await this.persistence.knowledge.save(document);
    this.logger.info("Knowledge document ingested", {
      workspaceId: input.workspaceId,
      title: input.title
    });
    return document;
  }

  async list(workspaceId: string) {
    return this.persistence.knowledge.list(workspaceId);
  }

  async query(workspaceId: string, term: string, limit = 5): Promise<KnowledgeDocumentRecord[]> {
    const response = await this.semanticSearch(workspaceId, term, {
      limit,
      injectLimit: limit
    });
    const documents = await this.list(workspaceId);
    const byId = new Map(documents.map((document) => [document.id, document]));
    return response.results
      .map((result) => byId.get(result.id))
      .filter((document): document is KnowledgeDocumentRecord => Boolean(document));
  }

  async semanticSearch(
    workspaceId: string,
    query: string,
    options: {
      limit?: number | undefined;
      injectLimit?: number | undefined;
    } = {}
  ): Promise<SemanticSearchResponse> {
    const limit = options.limit ?? 8;
    const injectLimit = options.injectLimit ?? 5;
    const embedding = await generateEmbedding(query);
    const matches = await this.persistence.knowledge.search(workspaceId, embedding.values, limit * 2);
    const results = matches
      .map((match) => toSearchResult(match.document, match.similarity))
      .sort((left, right) => right.score.score - left.score.score)
      .slice(0, limit);

    return {
      workspaceId,
      query,
      generatedAt: new Date().toISOString(),
      results,
      injectedResults: results.slice(0, injectLimit)
    };
  }

  async export(workspaceId: string) {
    const documents = await this.list(workspaceId);
    return {
      workspaceId,
      exportedAt: new Date().toISOString(),
      documents
    };
  }

  async summary(workspaceId: string) {
    const documents = await this.list(workspaceId);
    return {
      workspaceId,
      documentCount: documents.length,
      latestTitles: documents.slice(0, 5).map((document) => document.title)
    };
  }

  health(): ServiceHealth {
    const embeddingStatus = embeddingRuntimeStatus();
    return {
      name: "knowledge-service",
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
          message: `Knowledge persistence is running in ${this.persistence.mode} mode.`
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

export const buildKnowledgeServiceApp = () => {
  const app = Fastify();
  const service = new KnowledgeService();
  const config = loadPlatformConfig();

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.get("/internal/knowledge/workspaces/:workspaceId/documents", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.list(params.workspaceId);
  });

  app.post("/internal/knowledge/workspaces/:workspaceId/documents", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    const body = request.body as {
      title: string;
      body: string;
      metadata?: Record<string, unknown>;
    };
    return service.ingest({
      workspaceId: params.workspaceId,
      title: body.title,
      body: body.body,
      metadata: body.metadata
    });
  });

  app.post("/internal/knowledge/workspaces/:workspaceId/query", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    const body = request.body as { term?: string; query?: string; limit?: number };
    return service.query(params.workspaceId, body.query ?? body.term ?? "", body.limit ?? 5);
  });

  app.post("/internal/knowledge/workspaces/:workspaceId/search", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    const body = request.body as { query: string; limit?: number; injectLimit?: number };
    return service.semanticSearch(params.workspaceId, body.query, {
      limit: body.limit,
      injectLimit: body.injectLimit
    });
  });

  app.get("/internal/knowledge/workspaces/:workspaceId/export", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.export(params.workspaceId);
  });

  app.get("/internal/knowledge/workspaces/:workspaceId/summary", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    assertWorkspaceAccess(
      authContextFromHeaders(request.headers as Record<string, string | string[] | undefined>),
      params.workspaceId
    );
    return service.summary(params.workspaceId);
  });

  return {
    app,
    service
  };
};
