import type { FileService } from "@jeanbot/file-service";
import type { MissionRecord } from "@jeanbot/types";

export class CheckpointManager {
  constructor(private readonly fileService: FileService) {}

  async prepare(record: MissionRecord, workspaceRoot: string) {
    if (!record.plan) {
      return undefined;
    }

    const shouldCheckpoint =
      record.objective.risk === "high" ||
      record.objective.risk === "critical" ||
      record.plan.steps.some((step) => step.toolKind === "filesystem" || step.toolKind === "terminal");

    if (!shouldCheckpoint) {
      return undefined;
    }

    return this.fileService.createCheckpoint(
      workspaceRoot,
      record.objective.id,
      "Automatic pre-execution checkpoint"
    );
  }
}
