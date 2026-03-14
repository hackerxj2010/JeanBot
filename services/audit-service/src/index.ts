import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import type { AuditEvent, ServiceHealth } from "@jeanbot/types";

export class AuditService {
  private readonly logger = createLogger("audit-service");
  private readonly persistence = createPersistenceBundle();

  async record(kind: string, entityId: string, actor: string, details: Record<string, unknown>) {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      kind,
      entityId,
      actor,
      details,
      createdAt: new Date().toISOString()
    };

    await this.persistence.audit.save(event);
    this.logger.info("Recorded audit event", { kind, entityId, actor });
    return event;
  }

  async list(entityId?: string) {
    const events = (await this.persistence.audit.list(entityId)).sort((left, right) => {
      return left.createdAt.localeCompare(right.createdAt);
    });
    return events;
  }

  health(): ServiceHealth {
    return {
      name: "audit-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode
      }
    };
  }
}
