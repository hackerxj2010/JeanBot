import type { MissionOrchestrator } from "@jeanbot/agent-orchestrator";
import type { AutomationService } from "@jeanbot/automation-service";
import { missionRequestSchema } from "@jeanbot/schemas";

export const createMissionController = (
  orchestrator: MissionOrchestrator,
  automationService: AutomationService
) => ({
  createMission(body: unknown) {
    const payload = missionRequestSchema.parse(body);
    return orchestrator.createMission(payload);
  },

  planMission(missionId: string) {
    return orchestrator.planMission(missionId);
  },

  runMission(missionId: string, workspaceRoot: string) {
    return orchestrator.runMission(missionId, workspaceRoot);
  },

  getMission(missionId: string) {
    return orchestrator.getMission(missionId);
  },

  listMissions() {
    return orchestrator.listMissions();
  },

  listCapabilities() {
    return orchestrator.listCapabilities();
  },

  listTools() {
    return orchestrator.listTools();
  },

  getWorkspaceMemory(workspaceId: string) {
    return orchestrator.workspaceMemory(workspaceId);
  },

  listAuditEvents(entityId?: string) {
    return orchestrator.listAuditEvents(entityId);
  },

  createHeartbeat(body: {
    workspaceId: string;
    name: string;
    schedule: string;
    objective: string;
    active?: boolean;
  }) {
    return automationService.createHeartbeat({
      workspaceId: body.workspaceId,
      name: body.name,
      schedule: body.schedule,
      objective: body.objective,
      active: body.active ?? true
    });
  },

  listHeartbeats() {
    return automationService.listHeartbeats();
  },

  triggerHeartbeat(id: string) {
    return automationService.triggerHeartbeat(id);
  }
});
