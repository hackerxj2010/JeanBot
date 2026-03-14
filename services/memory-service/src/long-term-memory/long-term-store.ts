import { cosineSimilarity } from "@jeanbot/ai";
import type { MemoryRecord } from "@jeanbot/types";

export class LongTermMemoryStore {
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

  /**
   * Search for relevant long-term memories using cosine similarity on embeddings.
   * This provides the foundation for "Cross-Mission Context Harmonization".
   */
  async search(workspaceId: string, queryVector: number[], limit = 10) {
    const all = this.list(workspaceId);
    const scored = all
      .filter((record) => record.embedding && record.embedding.length > 0)
      .map((record) => ({
        record,
        similarity: cosineSimilarity(queryVector, record.embedding)
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);

    return scored;
  }
}
