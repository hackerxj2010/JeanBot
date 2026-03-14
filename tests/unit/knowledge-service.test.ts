import { describe, expect, it } from "vitest";

import { KnowledgeService } from "../../services/knowledge-service/src/index.js";

describe("KnowledgeService", () => {
  it("stores and queries workspace knowledge documents", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    const workspaceId = `knowledge-workspace-${Date.now()}`;
    const service = new KnowledgeService();

    const stored = await service.ingest({
      workspaceId,
      title: "JeanBot memory architecture",
      body: "JeanBot stores short-term memory in Redis and long-term memory in Postgres.",
      metadata: {
        domain: "architecture"
      }
    });

    const queried = await service.query(workspaceId, "Redis");

    expect(stored.contentHash.length).toBeGreaterThan(10);
    expect(queried.length).toBeGreaterThanOrEqual(1);
    expect(queried[0].title).toContain("memory architecture");
  });
});
