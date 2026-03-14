import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentRuntimeService } from "../../services/agent-runtime/src/index.js";
import type { MissionObjective } from "../../packages/types/src/index.js";

describe("AgentRuntimeService", () => {
  it("executes a task with tool calls and returns a structured runtime result", async () => {
    const runtime = new AgentRuntimeService();
    const workspaceRoot = path.resolve("tmp", "sessions", "agent-runtime-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const objective: MissionObjective = {
      id: `mission-${Date.now()}`,
      workspaceId: "workspace-runtime-test",
      userId: "user-runtime-test",
      title: "Inspect workspace",
      objective: "Inspect the workspace and preserve a checkpoint before execution.",
      context: "Backend only.",
      constraints: ["No UI work"],
      requiredCapabilities: ["filesystem"],
      risk: "medium" as const,
      createdAt: new Date().toISOString()
    };

    const step = {
      id: `${objective.id}-step-1`,
      title: "Create safety checkpoint",
      description: "Inspect the workspace and create a checkpoint.",
      capability: "filesystem" as const,
      stage: "preflight" as const,
      toolKind: "filesystem" as const,
      dependsOn: [],
      verification: "A checkpoint exists and the workspace scan completed.",
      assignee: "file-operator",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: "Inspect the workspace and capture a safe checkpoint.",
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.01,
      checkpoints: [step.id],
      alternatives: [],
      generatedAt: new Date().toISOString()
    };

    const result = await runtime.executeTask({
      objective,
      step,
      plan,
      template: {
        id: "subagent-filesystem",
        role: "file-operator",
        specialization: "filesystem",
        instructions: "Inspect the workspace and checkpoint it.",
        maxParallelTasks: 2,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        toolIds: ["filesystem.workspace.scan", "filesystem.checkpoint.create"]
      },
      context: {
        sessionId: crypto.randomUUID(),
        workspaceRoot,
        jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
        planMode: true,
        maxParallelism: 2
      }
    });

    expect(result.finalText.length).toBeGreaterThan(0);
    expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "filesystem.workspace.scan")).toBe(true);
    expect(result.verification.ok).toBe(true);
  });

  it("runs browser follow-up tools after navigation when the objective needs extracted proof", async () => {
    const runtime = new AgentRuntimeService();
    const workspaceRoot = path.resolve("tmp", "sessions", "agent-runtime-browser-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const objective: MissionObjective = {
      id: `mission-browser-${Date.now()}`,
      workspaceId: "workspace-runtime-browser-test",
      userId: "user-runtime-browser-test",
      title: "Inspect example website",
      objective: "Open https://example.com, extract the page text, and capture a screenshot as proof.",
      context: "Backend only browser validation.",
      constraints: ["No UI work"],
      requiredCapabilities: ["browser", "research"],
      risk: "medium" as const,
      createdAt: new Date().toISOString()
    };

    const step = {
      id: `${objective.id}-step-1`,
      title: "Navigate and capture proof",
      description: "Visit the target website, extract page contents, and capture browser state.",
      capability: "browser" as const,
      stage: "execution" as const,
      toolKind: "browser" as const,
      dependsOn: [],
      verification: "The browser session was navigated, extracted, and captured.",
      assignee: "browser-operator",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: "Navigate a website and keep proof of what was observed.",
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.02,
      checkpoints: [],
      alternatives: [],
      generatedAt: new Date().toISOString()
    };

    const result = await runtime.executeTask({
      objective,
      step,
      plan,
      template: {
        id: "subagent-browser",
        role: "browser-operator",
        specialization: "browser",
        instructions: "Navigate, extract, and capture only what supports the task.",
        maxParallelTasks: 1,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        toolIds: [
          "browser.session.navigate",
          "browser.session.extract",
          "browser.session.capture"
        ]
      },
      context: {
        sessionId: crypto.randomUUID(),
        workspaceRoot,
        jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
        planMode: true,
        maxParallelism: 1
      }
    });

    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "browser.session.navigate")).toBe(true);
    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "browser.session.extract")).toBe(true);
    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "browser.session.capture")).toBe(true);
    expect(result.verification.ok).toBe(true);
  });

  it("chains research search results into browser navigation and evidence capture", async () => {
    const runtime = new AgentRuntimeService();
    const workspaceRoot = path.resolve("tmp", "sessions", "agent-runtime-research-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const objective: MissionObjective = {
      id: `mission-research-${Date.now()}`,
      workspaceId: "workspace-runtime-research-test",
      userId: "user-runtime-research-test",
      title: "Research deployment safeguards",
      objective:
        "Research deployment safeguards, collect source links, and capture page proof for the best source.",
      context: "Backend only research validation.",
      constraints: ["No UI work"],
      requiredCapabilities: ["research", "browser"],
      risk: "medium" as const,
      createdAt: new Date().toISOString()
    };

    const step = {
      id: `${objective.id}-step-1`,
      title: "Search and inspect the strongest source",
      description: "Search for evidence, navigate to the strongest source, and keep proof.",
      capability: "research" as const,
      stage: "execution" as const,
      toolKind: "browser" as const,
      dependsOn: [],
      verification: "A search result was opened and evidence was collected from it.",
      assignee: "researcher",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: "Research a topic and capture browser-backed evidence from a discovered source.",
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.02,
      checkpoints: [],
      alternatives: [],
      generatedAt: new Date().toISOString()
    };

    const result = await runtime.executeTask({
      objective,
      step,
      plan,
      template: {
        id: "subagent-research",
        role: "researcher",
        specialization: "research",
        instructions: "Search, inspect the strongest source, and keep concrete evidence.",
        maxParallelTasks: 1,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        toolIds: [
          "search.query",
          "browser.session.navigate",
          "browser.session.extract",
          "browser.session.capture"
        ]
      },
      context: {
        sessionId: crypto.randomUUID(),
        workspaceRoot,
        jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
        planMode: true,
        maxParallelism: 1
      }
    });

    const navigateCall = result.toolCalls.find(
      (toolCall) => toolCall.toolId === "browser.session.navigate"
    );

    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "search.query")).toBe(true);
    expect(navigateCall?.payloadPreview).toContain("/search/1?q=");
    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "browser.session.extract")).toBe(
      true
    );
    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "browser.session.capture")).toBe(
      true
    );
    expect(result.verification.ok).toBe(true);
  });

  it("reads terminal output and persists an artifact for software-development steps", async () => {
    const runtime = new AgentRuntimeService();
    const workspaceRoot = path.resolve("tmp", "sessions", "agent-runtime-terminal-test");

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const objective: MissionObjective = {
      id: `mission-terminal-${Date.now()}`,
      workspaceId: "workspace-runtime-terminal-test",
      userId: "user-runtime-terminal-test",
      title: "Run verification commands",
      objective: "Run a workspace inventory command and save the output report for the workspace.",
      context: "Backend only terminal validation.",
      constraints: ["No UI work"],
      requiredCapabilities: ["software-development", "terminal"],
      risk: "medium" as const,
      createdAt: new Date().toISOString()
    };

    const step = {
      id: `${objective.id}-step-1`,
      title: "Run verification command",
      description: "Execute a terminal command, inspect stdout, and save a durable artifact.",
      capability: "software-development" as const,
      stage: "execution" as const,
      toolKind: "terminal" as const,
      dependsOn: [],
      verification: "A command ran, its output was collected, and an artifact was written.",
      assignee: "coder",
      status: "ready" as const
    };

    const plan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: "Run a terminal verification command and keep the result as an artifact.",
      steps: [step],
      estimatedDurationMinutes: 5,
      estimatedCostUsd: 0.02,
      checkpoints: [],
      alternatives: [],
      generatedAt: new Date().toISOString()
    };

    const result = await runtime.executeTask({
      objective,
      step,
      plan,
      template: {
        id: "subagent-coder",
        role: "coder",
        specialization: "software-development",
        instructions: "Run a safe verification command and persist the output.",
        maxParallelTasks: 1,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        toolIds: [
          "terminal.command.run",
          "terminal.command.output",
          "filesystem.artifact.write"
        ]
      },
      context: {
        sessionId: crypto.randomUUID(),
        workspaceRoot,
        jeanFilePath: path.join(workspaceRoot, "JEAN.md"),
        planMode: true,
        maxParallelism: 1
      }
    });

    expect(result.toolCalls.some((toolCall) => toolCall.toolId === "terminal.command.run")).toBe(
      true
    );
    expect(
      result.toolCalls.some((toolCall) => toolCall.toolId === "terminal.command.output")
    ).toBe(true);
    expect(
      result.toolCalls.some((toolCall) => toolCall.toolId === "filesystem.artifact.write")
    ).toBe(true);
    expect(result.verification.ok).toBe(true);
  });
});
