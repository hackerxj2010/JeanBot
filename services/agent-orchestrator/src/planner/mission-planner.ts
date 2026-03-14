import type { MissionObjective, MissionPlan, MissionStep, PolicyDecision, ToolKind } from "@jeanbot/types";

import { estimatePlanCost } from "../cost-control/cost-estimator.js";

const capabilityToToolKind: Partial<Record<MissionStep["capability"], ToolKind>> = {
  filesystem: "filesystem",
  terminal: "terminal",
  browser: "browser",
  research: "search",
  communication: "communication",
  heartbeat: "automation"
};

const titleForCapability: Record<MissionStep["capability"], string> = {
  reasoning: "Clarify mission constraints",
  planning: "Decompose objective into steps",
  terminal: "Run terminal-assisted implementation tasks",
  browser: "Gather browser context",
  filesystem: "Inspect workspace files",
  memory: "Load and update memory context",
  research: "Research supporting evidence",
  subagents: "Parallelize specialist execution",
  communication: "Draft or send communications",
  skills: "Load relevant skill integrations",
  "software-development": "Implement core system changes",
  "data-analysis": "Analyze data and derive findings",
  writing: "Produce mission documentation",
  automation: "Design recurring or triggered workflows",
  "project-management": "Track status and coordination",
  heartbeat: "Define proactive monitoring",
  security: "Run policy and risk review",
  learning: "Store durable lessons",
  multimodality: "Handle non-text artifacts",
  finance: "Handle finance-sensitive workflows",
  orchestration: "Synthesize final mission result"
};

const createStep = (
  missionId: string,
  index: number,
  capability: MissionStep["capability"],
  dependsOn: string[],
  stage: MissionStep["stage"] = "execution"
): MissionStep => ({
  id: `${missionId}-step-${index}`,
  title: titleForCapability[capability],
  description: `JeanBot should execute capability "${capability}" for the mission.`,
  capability,
  stage,
  toolKind: capabilityToToolKind[capability],
  dependsOn: [...dependsOn],
  verification: `Confirm the ${capability} work advanced the mission objective.`,
  assignee: "main-agent",
  status: dependsOn.length === 0 ? "ready" : "pending"
});

export class MissionPlanner {
  createPlan(objective: MissionObjective, decision: PolicyDecision): MissionPlan {
    const steps: MissionStep[] = [];
    const uniqueCapabilities = [...new Set(objective.requiredCapabilities)];
    let index = 1;

    const preflight = createStep(objective.id, index++, "filesystem", [], "preflight");
    const memoryLoad = createStep(objective.id, index++, "memory", [preflight.id], "preflight");
    const securityReview = createStep(objective.id, index++, "security", [memoryLoad.id], "analysis");
    const planning = createStep(objective.id, index++, "planning", [securityReview.id], "analysis");

    steps.push(preflight, memoryLoad, securityReview, planning);

    if (decision.approvalRequired || objective.risk === "high" || objective.risk === "critical") {
      steps.push({
        id: `${objective.id}-step-${index++}`,
        title: "Create safety checkpoint",
        description: "Create a checkpoint before risky execution phases.",
        capability: "filesystem",
        stage: "preflight",
        toolKind: "filesystem",
        dependsOn: [planning.id],
        verification: "A checkpoint file exists for the mission.",
        assignee: "main-agent",
        status: "pending"
      });
    }

    const executionBarrier = steps[steps.length - 1].id;
    const executionStepIds: string[] = [];
    for (const capability of uniqueCapabilities) {
      if (["filesystem", "memory", "planning", "security"].includes(capability)) {
        continue;
      }

      const step = createStep(objective.id, index++, capability, [executionBarrier], "execution");
      steps.push(step);
      executionStepIds.push(step.id);
    }

    if (uniqueCapabilities.length > 2 || uniqueCapabilities.includes("subagents")) {
      const coordination = createStep(
        objective.id,
        index++,
        "project-management",
        executionStepIds.length > 0 ? executionStepIds : [executionBarrier],
        "execution"
      );
      steps.push(coordination);
      executionStepIds.push(coordination.id);
    }

    const orchestration = createStep(
      objective.id,
      index++,
      "orchestration",
      executionStepIds.length > 0 ? executionStepIds : [executionBarrier],
      "verification"
    );
    const verification = createStep(
      objective.id,
      index++,
      "reasoning",
      [orchestration.id],
      "verification"
    );
    const delivery = createStep(
      objective.id,
      index++,
      "writing",
      [verification.id],
      "delivery"
    );

    steps.push(orchestration, verification, delivery);

    const plan: MissionPlan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: `JeanBot will preflight the workspace, review risk, decompose the mission, execute the required capabilities, verify the output, and deliver a structured report for "${objective.title}".`,
      steps,
      estimatedDurationMinutes: steps.length * 7,
      estimatedCostUsd: 0,
      checkpoints: steps
        .filter((step) => step.title.toLowerCase().includes("checkpoint"))
        .map((step) => step.id),
      alternatives: [
        "Reduce scope to a backend-only milestone if a capability is blocked.",
        "Escalate approval-gated work instead of attempting unsafe automation.",
        "Swap real integrations for synthetic or local adapters during development."
      ],
      generatedAt: new Date().toISOString()
    };

    plan.estimatedCostUsd = estimatePlanCost(plan);
    return plan;
  }
}
