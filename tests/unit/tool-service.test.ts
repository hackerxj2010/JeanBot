import { describe, expect, it } from "vitest";

import { ToolService } from "../../services/tool-service/src/index.js";

describe("ToolService", () => {
  it("executes workspace memory tools with rich execution metadata", async () => {
    const service = new ToolService();
    const workspaceId = `tool-workspace-${Date.now()}`;

    const result = await service.execute({
      missionId: `mission-${Date.now()}`,
      toolId: "memory.remember",
      action: "remember",
      payload: {
        workspaceId,
        text: "Store a durable note through the tool service.",
        tags: ["tool-service", "memory"],
        scope: "short-term",
        importance: 0.8
      },
      authContext: {
        tenantId: "tenant-tool",
        userId: "user-tool",
        workspaceIds: [workspaceId],
        roleIds: ["admin"],
        permissions: ["tools:use", "missions:read", "missions:write"],
        subjectType: "user"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.descriptor.id).toBe("memory.remember");
    expect(result.grantedPermissions).toContain("write");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.policy.allowed).toBe(true);
  });

  it("supports batch execution and reports failed tool calls without aborting when configured", async () => {
    const service = new ToolService();
    const workspaceId = `tool-batch-workspace-${Date.now()}`;

    const result = await service.executeBatch({
      continueOnError: true,
      requests: [
        {
          missionId: `mission-batch-${Date.now()}`,
          toolId: "knowledge.document.ingest",
          action: "ingest",
          payload: {
            workspaceId,
            title: "Batch doc",
            body: "Batch execution can mix successful and failed requests."
          },
          authContext: {
            tenantId: "tenant-tool",
            userId: "user-tool",
            workspaceIds: [workspaceId],
            roleIds: ["admin"],
            permissions: ["tools:use", "knowledge:write"],
            subjectType: "user"
          }
        },
        {
          missionId: `mission-batch-${Date.now()}-missing`,
          toolId: "tool.missing",
          action: "missing",
          payload: {},
          authContext: {
            tenantId: "tenant-tool",
            userId: "user-tool",
            workspaceIds: [workspaceId],
            roleIds: ["admin"],
            permissions: ["tools:use"],
            subjectType: "user"
          }
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.succeededCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.results[0]?.ok).toBe(true);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.results[1]?.descriptor.id).toBe("tool.missing");
  });

  it("blocks tool execution outside the subagent execution scope", async () => {
    const service = new ToolService();
    const workspaceRoot = "E:/Cash_PRJ/nexus-autonomy/JeanBot/tmp/sessions/tool-scope-test";

    await expect(
      service.execute({
        missionId: `mission-scope-${Date.now()}`,
        toolId: "filesystem.file.write",
        action: "write",
        payload: {
          workspaceRoot,
          relativePath: "blocked.txt",
          content: "should not be written"
        },
        allowedToolIds: ["memory.summary"],
        authContext: {
          tenantId: "tenant-tool",
          userId: "user-tool",
          workspaceIds: ["workspace-tool-scope"],
          roleIds: ["admin"],
          permissions: ["tools:use"],
          subjectType: "user"
        }
      })
    ).rejects.toThrow(/outside the execution scope/i);
  });
});
