import type { MissionObjective } from "@jeanbot/types";

export const createMissionFixture = (
  overrides: Partial<MissionObjective> = {}
): MissionObjective => ({
  id: "mission-fixture",
  workspaceId: "workspace-demo",
  userId: "user-demo",
  title: "Launch a backend foundation",
  objective: "Create a backend-first autonomous agent platform foundation.",
  context: "The UI is intentionally out of scope.",
  constraints: ["Do not implement the UI"],
  desiredOutcome: "A runnable backend core monorepo",
  requiredCapabilities: ["planning", "filesystem", "memory", "orchestration"],
  risk: "medium",
  createdAt: new Date().toISOString(),
  ...overrides
});
