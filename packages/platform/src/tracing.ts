import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface TraceContext {
  traceId: string;
  correlationId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return randomUUID().replaceAll('-', '');
}

export function getTraceContext(): TraceContext {
  return traceStorage.getStore() ?? { traceId: 'untraced', correlationId: 'untraced' };
}

export function runWithTrace<T>(context: TraceContext, callback: () => T): T {
  return traceStorage.run(context, callback);
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestedTraceId = req.header('x-trace-id') ?? req.header('x-request-id');
    const traceId = requestedTraceId && /^[a-zA-Z0-9-]{8,128}$/.test(requestedTraceId)
      ? requestedTraceId
      : newTraceId();
    const correlationId = req.header('x-correlation-id') ?? traceId;

    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-correlation-id', correlationId);
    runWithTrace({ traceId, correlationId }, next);
  }
}
