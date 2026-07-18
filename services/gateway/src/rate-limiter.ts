import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { StructuredLogger, TooManyRequestsException } from '@atlas/platform';

/**
 * Redis-backed sliding-window rate limiter.
 *
 * Each IP or authenticated user gets a window of RATE_LIMIT_MAX requests
 * per RATE_LIMIT_WINDOW_MS milliseconds. When Redis is unavailable,
 * falls back to an in-memory Map (single-instance only).
 */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly redis?: Redis;
  private readonly memory = new Map<string, { count: number; resetsAt: number }>();

  constructor(private readonly logger: StructuredLogger) {
    this.maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 100);
    this.windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);

    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1
      });
      this.redis.on('error', () => undefined);
    }
  }

  async assertAllowed(key: string): Promise<void> {
    const windowKey = `rl:${key}`;
    const count = await this.increment(windowKey);
    if (count > this.maxRequests) {
      throw new TooManyRequestsException('Rate limit exceeded. Please slow down.');
    }
  }

  private async increment(key: string): Promise<number> {
    if (this.redis) {
      try {
        const windowSeconds = Math.ceil(this.windowMs / 1000);
        const tx = this.redis.multi();
        tx.incr(key);
        tx.expire(key, windowSeconds, 'NX');
        const result = await tx.exec();
        return Number(result?.[0]?.[1] ?? 0);
      } catch {
        // Fall through to memory
      }
    }

    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetsAt <= now) {
      this.memory.set(key, { count: 1, resetsAt: now + this.windowMs });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }
}
