import type { MemoryRecord } from "@jeanbot/types";

export const retrieveByQuery = (records: MemoryRecord[], query: string) => {
  const normalized = query.toLowerCase();
  return records.filter(
    (record) =>
      record.text.toLowerCase().includes(normalized) ||
      record.tags.some((tag) => tag.toLowerCase().includes(normalized))
  );
};
