import { Queue, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";

import type { QueueJob, QueueJobKind } from "@jeanbot/types";

export class InMemoryQueue<T> {
  protected items: T[] = [];

  enqueue(item: T) {
    this.items.push(item);
  }

  dequeue() {
    return this.items.shift();
  }

  size() {
    return this.items.length;
  }

  async drain(processor: (item: T) => Promise<void>) {
    while (this.items.length > 0) {
      const next = this.dequeue();
      if (!next) {
        break;
      }

      await processor(next);
    }
  }
}

export interface JobQueueAdapter {
  enqueue<TPayload>(job: QueueJob<TPayload>): Promise<void>;
  consume<TPayload>(
    kind: QueueJobKind,
    handler: (job: QueueJob<TPayload>) => Promise<void>
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export class LocalJobQueue implements JobQueueAdapter {
  private readonly queues = new Map<QueueJobKind, InMemoryQueue<QueueJob>>();
  private readonly timers = new Set<NodeJS.Timeout>();

  private queue(kind: QueueJobKind) {
    const queue = this.queues.get(kind) ?? new InMemoryQueue<QueueJob>();
    this.queues.set(kind, queue);
    return queue;
  }

  async enqueue<TPayload>(job: QueueJob<TPayload>) {
    this.queue(job.kind).enqueue(job as QueueJob);
  }

  async consume<TPayload>(
    kind: QueueJobKind,
    handler: (job: QueueJob<TPayload>) => Promise<void>
  ) {
    const queue = this.queue(kind);
    const timer = setInterval(async () => {
      await queue.drain(async (job) => {
        await handler(job as QueueJob<TPayload>);
      });
    }, 100);

    this.timers.add(timer);

    return async () => {
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  async close() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }

    this.timers.clear();
    this.queues.clear();
  }
}

export class RedisJobQueue implements JobQueueAdapter {
  private readonly workers = new Set<Worker>();
  private readonly queues = new Map<QueueJobKind, Queue>();
  private readonly connection: ConnectionOptions;

  constructor(redisUrl: string, private readonly prefix = "jeanbot") {
    this.connection = this.createConnection(redisUrl);
  }

  private createConnection(redisUrl: string): ConnectionOptions {
    const parsed = new URL(redisUrl);
    const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
    const connection: {
      host: string;
      port: number;
      maxRetriesPerRequest: null;
      username?: string | undefined;
      password?: string | undefined;
      db?: number | undefined;
      tls?: Record<string, never> | undefined;
    } = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      maxRetriesPerRequest: null
    };

    if (parsed.username) {
      connection.username = decodeURIComponent(parsed.username);
    }

    if (parsed.password) {
      connection.password = decodeURIComponent(parsed.password);
    }

    if (database !== undefined && !Number.isNaN(database)) {
      connection.db = database;
    }

    if (parsed.protocol === "rediss:") {
      connection.tls = {};
    }

    return connection;
  }

  private queueName(kind: QueueJobKind) {
    return `jobs-${kind.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  }

  private queue(kind: QueueJobKind) {
    let queue = this.queues.get(kind);
    if (!queue) {
      queue = new Queue(this.queueName(kind), {
        connection: this.connection,
        prefix: this.prefix
      });
      this.queues.set(kind, queue);
    }

    return queue;
  }

  async enqueue<TPayload>(job: QueueJob<TPayload>) {
    await this.queue(job.kind).add(job.kind, job, {
      jobId: job.id,
      attempts: job.maxAttempts,
      removeOnComplete: 200,
      removeOnFail: 200
    });
  }

  async consume<TPayload>(
    kind: QueueJobKind,
    handler: (job: QueueJob<TPayload>) => Promise<void>
  ) {
    const worker = new Worker(
      this.queueName(kind),
      async (job) => {
        await handler(job.data as QueueJob<TPayload>);
      },
      {
        connection: this.connection,
        prefix: this.prefix
      }
    );

    this.workers.add(worker);

    return async () => {
      this.workers.delete(worker);
      await worker.close();
    };
  }

  async close() {
    await Promise.allSettled(
      [...this.workers].map(async (worker) => {
        this.workers.delete(worker);
        await worker.close();
      })
    );

    await Promise.allSettled(
      [...this.queues.values()].map(async (queue) => {
        await queue.close();
      })
    );

    this.queues.clear();
  }
}
