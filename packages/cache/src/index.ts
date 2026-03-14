import crypto from "node:crypto";

import { Redis } from "ioredis";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  set(key: string, value: T, ttlMs: number) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  get(key: string) {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  delete(key: string) {
    this.store.delete(key);
  }
}

export interface SlidingWindowLimit {
  limit: number;
  windowMs: number;
  segment?: string | undefined;
}

export interface SlidingWindowDecision {
  allowed: boolean;
  identifier: string;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private redis: Redis | undefined;
  private redisDisabled = false;
  private readonly localWindows = new Map<string, number[]>();
  private readonly prefix: string;

  constructor(input: { redisUrl?: string | undefined; prefix?: string | undefined } = {}) {
    this.redis = input.redisUrl
      ? new Redis(input.redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 500
        })
      : undefined;
    this.redis?.on("error", () => {
      this.disableRedis();
    });
    this.prefix = input.prefix ?? "jeanbot:ratelimit";
  }

  private disableRedis() {
    if (this.redisDisabled) {
      return;
    }

    this.redisDisabled = true;
    this.redis?.disconnect(false);
    this.redis = undefined;
  }

  private keyFor(identifier: string, limit: SlidingWindowLimit) {
    return `${this.prefix}:${limit.segment ?? "default"}:${identifier}`;
  }

  private localConsume(identifier: string, limit: SlidingWindowLimit): SlidingWindowDecision {
    const key = this.keyFor(identifier, limit);
    const now = Date.now();
    const cutoff = now - limit.windowMs;
    const existing = (this.localWindows.get(key) ?? []).filter((value) => value > cutoff);
    if (existing.length >= limit.limit) {
      const oldest = existing[0] ?? now;
      this.localWindows.set(key, existing);
      return {
        allowed: false,
        identifier,
        limit: limit.limit,
        remaining: 0,
        resetAt: oldest + limit.windowMs,
        retryAfterMs: Math.max(1, oldest + limit.windowMs - now)
      };
    }

    existing.push(now);
    this.localWindows.set(key, existing);
    const oldest = existing[0] ?? now;
    return {
      allowed: true,
      identifier,
      limit: limit.limit,
      remaining: Math.max(0, limit.limit - existing.length),
      resetAt: oldest + limit.windowMs,
      retryAfterMs: 0
    };
  }

  async consume(identifier: string, limit: SlidingWindowLimit): Promise<SlidingWindowDecision> {
    if (!this.redis || this.redisDisabled) {
      return this.localConsume(identifier, limit);
    }

    try {
      if (this.redis.status === "wait") {
        await this.redis.connect();
      }

      const key = this.keyFor(identifier, limit);
      const now = Date.now();
      const member = `${now}:${crypto.randomUUID()}`;
      const cutoff = now - limit.windowMs;

      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, cutoff);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, limit.windowMs);
      const results = await pipeline.exec();
      const count = Number(results?.[2]?.[1] ?? 0);

      if (count <= limit.limit) {
        const oldestRaw = await this.redis.zrange(key, 0, 0, "WITHSCORES");
        const oldest = oldestRaw.length >= 2 ? Number(oldestRaw[1]) : now;
        return {
          allowed: true,
          identifier,
          limit: limit.limit,
          remaining: Math.max(0, limit.limit - count),
          resetAt: oldest + limit.windowMs,
          retryAfterMs: 0
        };
      }

      await this.redis.zrem(key, member);
      const oldestRaw = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const oldest = oldestRaw.length >= 2 ? Number(oldestRaw[1]) : now;
      const stableCount = Math.max(0, count - 1);
      return {
        allowed: false,
        identifier,
        limit: limit.limit,
        remaining: Math.max(0, limit.limit - stableCount),
        resetAt: oldest + limit.windowMs,
        retryAfterMs: Math.max(1, oldest + limit.windowMs - now)
      };
    } catch {
      this.disableRedis();
      return this.localConsume(identifier, limit);
    }
  }

  async close() {
    if (!this.redis) {
      return;
    }

    await this.redis.quit().catch(() => undefined);
  }
}
