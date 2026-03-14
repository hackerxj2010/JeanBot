import { missionPlanSchema, missionRequestSchema } from "@jeanbot/schemas";
import { riskFromText } from "@jeanbot/security";
import type { MissionObjective, MissionPlan } from "@jeanbot/types";

export const validateMissionInput = (input: unknown) => {
  const parsed = missionRequestSchema.parse(input);
  const risk = parsed.risk ?? riskFromText(parsed.objective);

  const objective: MissionObjective = {
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    risk
  };

  return objective;
};

export const validateMissionPlan = (plan: MissionPlan) => {
  missionPlanSchema.parse(plan);
  const stepIds = new Set(plan.steps.map((step) => step.id));

  for (const step of plan.steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        throw new Error(`Unknown dependency "${dependency}" in step "${step.id}".`);
      }
    }
  }

  return plan;
};
