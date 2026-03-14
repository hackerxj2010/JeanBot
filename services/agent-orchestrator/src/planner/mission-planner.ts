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
  reasoning: "Deep Reasoning and Constraint Analysis",
  planning: "Strategic Mission Decomposition",
  terminal: "Terminal-Native System Operations",
  browser: "Autonomous Web and UI Exploration",
  filesystem: "Recursive Workspace Inspection",
  memory: "Cross-Mission Context Harmonization",
  research: "Multi-Source Evidence Gathering",
  subagents: "Specialist Swarm Orchestration",
  communication: "Strategic Multi-Channel Communication",
  skills: "Dynamic Skill Integration and Activation",
  "software-development": "High-Fidelity Codebase Engineering",
  "data-analysis": "Advanced Analytical Synthesis",
  writing: "Professional Deliverable Production",
  automation: "End-to-End Workflow Synthesis",
  "project-management": "Mission Lifecycle Coordination",
  heartbeat: "Proactive Operational Monitoring",
  security: "Zero-Trust Policy and Risk Audit",
  learning: "Autonomous Pattern Extraction and Learning",
  multimodality: "Omni-Channel Artifact Processing",
  finance: "Secure Financial Workflow Execution",
  orchestration: "Universal Result Synthesis",
  synthesis: "Autonomous Tool and Logic Synthesis",
  verification: "Multi-Agent Adversarial Verification"
};

const createStep = (
  missionId: string,
  index: number,
  capability: MissionStep["capability"],
  dependsOn: string[],
  stage: MissionStep["stage"] = "execution",
  customDescription?: string,
  customVerification?: string
): MissionStep => ({
  id: `${missionId}-step-${String(index).padStart(3, "0")}`,
  title: titleForCapability[capability],
  description: customDescription || `Execute the "${capability}" capability to advance the mission objective through specialized operations and domain expertise.`,
  capability,
  stage,
  toolKind: capabilityToToolKind[capability],
  dependsOn: [...dependsOn],
  verification: customVerification || `Verify that the "${capability}" operation produced measurable progress toward the objective and meets all defined quality gates.`,
  assignee: "main-agent",
  status: dependsOn.length === 0 ? "ready" : "pending"
});

export class MissionPlanner {
  private analyzeObjectiveKeywords(objectiveText: string): MissionStep["capability"][] {
    const text = objectiveText.toLowerCase();
    const map: Record<string, MissionStep["capability"]> = {
      "code": "software-development",
      "bug": "software-development",
      "fix": "software-development",
      "test": "verification",
      "search": "research",
      "find": "research",
      "browser": "browser",
      "scrape": "browser",
      "terminal": "terminal",
      "shell": "terminal",
      "script": "automation",
      "workflow": "automation",
      "email": "communication",
      "slack": "communication",
      "analyze": "data-analysis",
      "report": "writing",
      "document": "writing",
      "security": "security",
      "vuln": "security",
      "finance": "finance",
      "money": "finance",
      "custom": "synthesis",
      "new tool": "synthesis"
    };

    const suggested: MissionStep["capability"][] = [];
    for (const [kw, cap] of Object.entries(map)) {
      if (text.includes(kw)) {
        suggested.push(cap);
      }
    }
    return suggested;
  }

  createPlan(objective: MissionObjective, decision: PolicyDecision): MissionPlan {
    const steps: MissionStep[] = [];
    const keywordCapabilities = this.analyzeObjectiveKeywords(objective.objective);
    const uniqueCapabilities = [...new Set([...(objective.requiredCapabilities || []), ...keywordCapabilities])];
    let index = 1;

    // Phase 1: Preflight & Context (The "Claude Code" Foundation)
    const preflight = createStep(
      objective.id,
      index++,
      "filesystem",
      [],
      "preflight",
      "Perform a recursive scan of the workspace to build a comprehensive dependency graph and file manifest.",
      "Verify that the workspace state is documented and all target files are accessible."
    );
    const memoryLoad = createStep(
      objective.id,
      index++,
      "memory",
      [preflight.id],
      "preflight",
      "Load historical mission data and workspace-specific memories to provide long-term context awareness.",
      "Confirm that relevant semantic memories are injected into the active runtime frame."
    );

    // Phase 2: Analysis & Security (The "Secure Core" Edge)
    const securityReview = createStep(
      objective.id,
      index++,
      "security",
      [memoryLoad.id],
      "analysis",
      "Run a zero-trust policy audit on the proposed mission objective and required tools.",
      "Verify that the mission risk profile matches the workspace security posture."
    );
    const deepReasoning = createStep(
      objective.id,
      index++,
      "reasoning",
      [securityReview.id],
      "analysis",
      "Execute multi-turn reasoning to identify edge cases, constraints, and optimal execution paths.",
      "Ensure all technical and operational constraints are explicitly mapped."
    );
    const planning = createStep(
      objective.id,
      index++,
      "planning",
      [deepReasoning.id],
      "analysis",
      "Decompose the objective into a granular, verifiable execution graph.",
      "Confirm the execution graph is logically sound and addresses all constraints."
    );

    steps.push(preflight, memoryLoad, securityReview, deepReasoning, planning);

    // Phase 3: Risk Mitigation
    if (decision.approvalRequired || objective.risk === "high" || objective.risk === "critical") {
      steps.push(createStep(
        objective.id,
        index++,
        "filesystem",
        [planning.id],
        "preflight",
        "Create a versioned safety checkpoint of all sensitive workspace assets.",
        "Verify the checkpoint is durable and restorable."
      ));
    }

    const executionBarrier = steps[steps.length - 1].id;
    const executionStepIds: string[] = [];

    // Phase 4: Execution Swarm (The "Universal Agent" Core)
    // If the objective requires custom tools (Agent Zero style), synthesize them first
    if (uniqueCapabilities.includes("synthesis") || objective.objective.toLowerCase().includes("custom")) {
      const synthesis = createStep(
        objective.id,
        index++,
        "synthesis",
        [executionBarrier],
        "execution",
        "Synthesize autonomous tool logic to handle domain-specific requirements not covered by standard tools.",
        "Verify the synthesized tool is registered and passing its own internal validation tests."
      );
      steps.push(synthesis);
      executionStepIds.push(synthesis.id);
    }

    const currentBarrier = executionStepIds.length > 0 ? executionStepIds[executionStepIds.length - 1] : executionBarrier;

    for (const capability of uniqueCapabilities) {
      if (["filesystem", "memory", "planning", "security", "reasoning", "synthesis"].includes(capability)) {
        continue;
      }

      const step = createStep(objective.id, index++, capability, [currentBarrier], "execution");
      steps.push(step);
      executionStepIds.push(step.id);
    }

    // Phase 5: Verification & Delivery (The "AI Employee" Standard)
    const coordination = createStep(
      objective.id,
      index++,
      "project-management",
      executionStepIds,
      "execution",
      "Coordinate outputs from parallel specialist streams into a unified mission state.",
      "Verify all execution streams are synchronized and resolved."
    );
    steps.push(coordination);

    const orchestration = createStep(
      objective.id,
      index++,
      "orchestration",
      [coordination.id],
      "verification",
      "Synthesize all execution artifacts into the final mission deliverable.",
      "Confirm the deliverable addresses 100% of the mission objective."
    );
    const verification = createStep(
      objective.id,
      index++,
      "reasoning",
      [orchestration.id],
      "verification",
      "Perform a final adversarial verification to ensure no regressions or security gaps were introduced.",
      "Verify that the final output meets the 'Definition of Done'."
    );
    const learning = createStep(
      objective.id,
      index++,
      "learning",
      [verification.id],
      "verification",
      "Extract and persist durable lessons, patterns, and optimized tool usage from this mission.",
      "Confirm that workspace memory is updated with mission insights."
    );
    const delivery = createStep(
      objective.id,
      index++,
      "writing",
      [learning.id],
      "delivery",
      "Generate a professional mission report and notify stakeholders through communication channels.",
      "Verify the report is published and stakeholders are successfully updated."
    );

    steps.push(orchestration, verification, learning, delivery);

    const plan: MissionPlan = {
      id: `plan-${objective.id}`,
      missionId: objective.id,
      summary: `JeanBot will execute an advanced ${steps.length}-step mission for "${objective.title}". This includes recursive preflight, zero-trust security audit, dynamic tool synthesis, multi-specialist execution swarm, and autonomous learning extraction.`,
      steps,
      estimatedDurationMinutes: steps.length * 12, // Increased for deeper reasoning
      estimatedCostUsd: 0,
      checkpoints: steps
        .filter((step) => step.title.toLowerCase().includes("checkpoint"))
        .map((step) => step.id),
      alternatives: [
        "Dynamically synthesize custom tools if existing capabilities are insufficient.",
        "Re-route execution through sub-agent swarms if parallelism is required.",
        "Degrade to synthetic verification if live environment access is restricted.",
        "Escalate to human operator if policy-sensitive execution paths are detected."
      ],
      generatedAt: new Date().toISOString()
    };

    plan.estimatedCostUsd = estimatePlanCost(plan);
    return plan;
  }
}
