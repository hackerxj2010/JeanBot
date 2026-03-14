import type { Capability, MissionPlan } from "@jeanbot/types";

const costByCapability: Record<Capability, number> = {
  reasoning: 0.02,
  planning: 0.03,
  terminal: 0.02,
  browser: 0.02,
  filesystem: 0.01,
  memory: 0.01,
  research: 0.02,
  subagents: 0.03,
  communication: 0.01,
  skills: 0.02,
  "software-development": 0.04,
  "data-analysis": 0.03,
  writing: 0.02,
  automation: 0.02,
  "project-management": 0.01,
  heartbeat: 0.01,
  security: 0.03,
  learning: 0.01,
  multimodality: 0.03,
  finance: 0.05,
  orchestration: 0.03
};

export const estimatePlanCost = (plan: Pick<MissionPlan, "steps">) => {
  return Number(
    plan.steps
      .reduce((total, step) => total + costByCapability[step.capability], 0)
      .toFixed(2)
  );
};
