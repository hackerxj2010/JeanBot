import { createPersistenceBundle } from "@jeanbot/persistence";
import type {
  ApprovalRecord,
  MissionPlan,
  MissionRecord,
  MissionRunResult,
  MissionStateTransition
} from "@jeanbot/types";

export class MissionStateStore {
  private readonly missions = new Map<string, MissionRecord>();
  private readonly persistence = createPersistenceBundle();
  private readonly bootstrapped: Promise<void>;

  constructor() {
    this.bootstrapped = this.bootstrap();
  }

  private async bootstrap() {
    for (const record of await this.persistence.missions.list()) {
      this.missions.set(record.objective.id, record);
    }
  }

  async save(record: MissionRecord) {
    await this.bootstrapped;
    this.missions.set(record.objective.id, record);
    await this.persistence.missions.save(record);
    return record;
  }

  async get(missionId: string) {
    await this.bootstrapped;
    const persisted = await this.persistence.missions.get(missionId);
    if (persisted) {
      this.missions.set(missionId, persisted);
      return persisted;
    }

    return this.missions.get(missionId);
  }

  async updatePlan(missionId: string, plan: MissionPlan) {
    const record = await this.getOrThrow(missionId);
    record.plan = plan;
    record.status = "planned";
    record.lastUpdatedAt = new Date().toISOString();
    record.planVersion = plan.version ?? record.planVersion ?? 1;
    await this.save(record);
    return record;
  }

  async updateResult(missionId: string, result: MissionRunResult) {
    const record = await this.getOrThrow(missionId);
    record.result = result;
    record.status = result.status;
    record.lastUpdatedAt = new Date().toISOString();
    await this.save(record);
    return record;
  }

  async updateStatus(missionId: string, status: MissionRecord["status"]) {
    const record = await this.getOrThrow(missionId);
    record.status = status;
    record.lastUpdatedAt = new Date().toISOString();
    await this.save(record);
    return record;
  }

  async patch(
    missionId: string,
    updater: (record: MissionRecord) => MissionRecord | undefined
  ) {
    const record = await this.getOrThrow(missionId);
    const updated = updater(record) ?? record;
    updated.lastUpdatedAt = new Date().toISOString();
    await this.save(updated);
    return updated;
  }

  async saveApproval(approval: ApprovalRecord) {
    await this.persistence.missions.saveApproval(approval);
  }

  async approve(
    missionId: string,
    approvalId: string,
    approverId: string,
    status: ApprovalRecord["status"]
  ) {
    const updated = await this.persistence.missions.approve(missionId, approvalId, approverId, status);
    const record = await this.getOrThrow(missionId);
    if (!updated) {
      return undefined;
    }

    record.approvals = (record.approvals ?? []).map((approval) =>
      approval.id === approvalId ? updated : approval
    );
    await this.save(record);
    return updated;
  }

  async appendTransition(transition: MissionStateTransition) {
    await this.persistence.missions.appendTransition(transition);
  }

  async list() {
    await this.bootstrapped;
    const persisted = await this.persistence.missions.list();
    for (const record of persisted) {
      this.missions.set(record.objective.id, record);
    }

    return [...this.missions.values()];
  }

  private async getOrThrow(missionId: string) {
    await this.bootstrapped;
    const record = this.missions.get(missionId);
    if (!record) {
      throw new Error(`Mission "${missionId}" not found.`);
    }

    return record;
  }
}
