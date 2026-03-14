import type { SubAgentService } from "@jeanbot/subagent-service";
import type { MissionPlan } from "@jeanbot/types";

export class MissionDispatcher {
  constructor(private readonly subAgentService: SubAgentService) {}

  assign(plan: MissionPlan) {
    const templates = this.subAgentService.spawnForPlan(plan);

    plan.steps = plan.steps.map((step) => ({
      ...step,
      assignee: this.subAgentService.assignStep(step)
    }));

    return {
      plan,
      templates
    };
  }
}
