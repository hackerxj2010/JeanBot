import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { KnowledgeService } from "../../services/knowledge-service/src/index.js";
import { MemoryService } from "../../services/memory-service/src/index.js";

describe("MemoryService", () => {
  it("persists workspace memory across instances", async () => {
    await rm("tmp/runtime/memory", { recursive: true, force: true });
    const workspaceId = `workspace-alpha-${Date.now()}`;

    const first = new MemoryService();
    await first.remember(workspaceId, "Remember this persistent fact", ["fact"], "long-term", 0.9);

    const second = new MemoryService();
    const recalled = await second.recall(workspaceId, "persistent");

    expect(recalled.length).toBe(1);
    expect(recalled[0].text).toContain("persistent fact");
  });

  it("merges semantic retrieval across memory and knowledge", async () => {
    await rm("tmp/runtime/memory", { recursive: true, force: true });
    await rm("tmp/runtime/knowledge", { recursive: true, force: true });
    const workspaceId = `workspace-semantic-${Date.now()}`;

    const memory = new MemoryService();
    const knowledge = new KnowledgeService();

    await memory.remember(
      workspaceId,
      "JeanBot stores deployment runbooks in long-term memory.",
      ["runbook", "ops"],
      "long-term",
      0.9
    );
    await knowledge.ingest({
      workspaceId,
      title: "Deployment guide",
      body: "The deployment guide explains how JeanBot ships safely to production.",
      metadata: {
        importance: 0.8
      }
    });

    const search = await memory.semanticSearch(workspaceId, "production deployment runbook", {
      limit: 8,
      injectLimit: 5
    });

    expect(search.results.length).toBeGreaterThanOrEqual(2);
    expect(search.injectedResults.length).toBeLessThanOrEqual(5);
    expect(search.results.some((result) => result.sourceKind === "memory")).toBe(true);
    expect(search.results.some((result) => result.sourceKind === "knowledge")).toBe(true);
  });
});
