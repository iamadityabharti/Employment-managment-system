import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { TooManyRequestsException } from '@atlas/platform';

interface MemoryWindow {
  count: number;
  resetsAt: number;
}

@Injectable()
export class LoginRateLimiter implements OnModuleDestroy {
  private readonly limit = Number(process.env.LOGIN_RATE_LIMIT ?? 5);
  private readonly windowSeconds = Number(process.env.LOGIN_RATE_WINDOW_SECONDS ?? 60);
  private readonly memory = new Map<string, MemoryWindow>();
  private readonly redis?: Redis;

  constructor() {
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1
      });
      this.redis.on('error', () => undefined);
    }
  }

  async assertAllowed(subject: string): Promise<void> {
    const key = `auth:login:${createHash('sha256').update(subject.toLowerCase()).digest('hex')}`;
    const attempts = await this.increment(key);
    if (attempts > this.limit) {
      throw new TooManyRequestsException('Too many login attempts. Try again shortly.');
    }
  }

  private async increment(key: string): Promise<number> {
    if (this.redis) {
      try {
        const transaction = this.redis.multi();
        transaction.incr(key);
        transaction.expire(key, this.windowSeconds, 'NX');
        const result = await transaction.exec();
        return Number(result?.[0]?.[1] ?? 0);
      } catch {
        // Redis is a rate-limit accelerator, not an authentication availability dependency.
      }
    }
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetsAt <= now) {
      this.memory.set(key, { count: 1, resetsAt: now + this.windowSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }
}
