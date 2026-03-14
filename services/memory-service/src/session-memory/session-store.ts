import type { MemoryRecord } from "@jeanbot/types";

export class SessionMemoryStore {
  private readonly records = new Map<string, MemoryRecord[]>();

  add(record: MemoryRecord) {
    const existing = this.records.get(record.workspaceId) ?? [];
    existing.push(record);
    this.records.set(record.workspaceId, existing);
  }

  list(workspaceId: string) {
    return [...(this.records.get(workspaceId) ?? [])];
  }

  replace(workspaceId: string, records: MemoryRecord[]) {
    this.records.set(workspaceId, [...records]);
  }
}
