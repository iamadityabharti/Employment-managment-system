import { Controller, Get, Header, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { DatabaseService } from './postgres';
import { RabbitMqService } from './rabbitmq';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'atlas_http_requests_total',
    help: 'Total HTTP requests handled by this service',
    labelNames: ['method', 'path', 'status'] as const,
    registers: [this.registry]
  });
  private readonly duration = new Histogram({
    name: 'atlas_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path', 'status'] as const,
    registers: [this.registry],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'atlas_' });
  }

  recordRequest(method: string, path: string, status: number, elapsedMs: number): void {
    const labels = { method, path, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, elapsedMs / 1000);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();
    res.on('finish', () => {
      this.metrics.recordRequest(req.method, req.route?.path ?? req.path, res.statusCode, performance.now() - startedAt);
    });
    next();
  }
}

@Controller()
export class PlatformHealthController {
  constructor(
    private readonly metrics: MetricsService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() private readonly rabbitMq?: RabbitMqService
  ) {}

  @Get('health/live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; dependencies: Record<string, string> }> {
    const dependencies: Record<string, string> = {};
    if (this.database) {
      dependencies.postgres = (await this.database.ping()) ? 'ok' : 'unavailable';
    }
    if (this.rabbitMq) {
      dependencies.rabbitmq = this.rabbitMq.isConnected() ? 'ok' : 'degraded-outbox-retry';
    }
    return {
      status: Object.values(dependencies).every((value) => value === 'ok') ? 'ok' : 'degraded',
      dependencies
    };
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsEndpoint(): Promise<string> {
    return this.metrics.metrics();
  }
}
