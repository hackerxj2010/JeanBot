import type { MissionObjective, MissionPlan, MissionStep, SubAgentTemplate } from "@jeanbot/types";

export const buildJeanSystemPrompt = (
  jeanFile: string,
  objective: MissionObjective,
  planMode: boolean
) => {
  return [
    "You are JeanBot, an autonomous AI employee.",
    `Plan mode: ${planMode ? "enabled" : "disabled"}.`,
    `Mission title: ${objective.title}`,
    `Mission objective: ${objective.objective}`,
    `Desired outcome: ${objective.desiredOutcome ?? "Not specified"}`,
    `Constraints: ${objective.constraints.join("; ") || "None"}`,
    "Workspace rules from JEAN.md:",
    jeanFile
  ].join("\n");
};

export const buildPlanPrompt = (objective: MissionObjective) => {
  return [
    "Create the minimal reliable plan to achieve the objective.",
    `Objective: ${objective.objective}`,
    `Capabilities: ${objective.requiredCapabilities.join(", ")}`,
    `Risk level: ${objective.risk}`,
    `Context: ${objective.context || "No extra context"}`
  ].join("\n");
};

export const buildSpecialistPrompt = (
  template: SubAgentTemplate,
  step: MissionStep,
  plan: MissionPlan
) => {
  return [
    `Role: ${template.role}`,
    `Specialization: ${template.specialization}`,
    `Task: ${step.title}`,
    `Description: ${step.description}`,
    `Verification: ${step.verification}`,
    `Plan summary: ${plan.summary}`,
    `Instructions: ${template.instructions}`
  ].join("\n");
};
