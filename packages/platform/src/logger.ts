import { Injectable, LoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { getTraceContext } from './tracing';

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      name: process.env.SERVICE_NAME ?? 'atlas-service',
      level: process.env.LOG_LEVEL ?? 'info',
      base: undefined,
      formatters: {
        bindings: () => ({ service: process.env.SERVICE_NAME ?? 'atlas-service' })
      }
    });
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace ? { stack: trace } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    return this.logger.child({ ...getTraceContext(), ...bindings });
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace',
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>
  ): void {
    const metadata = { ...getTraceContext(), context, ...extra };
    if (typeof message === 'string') {
      this.logger[level](metadata, message);
      return;
    }
    this.logger[level]({ ...metadata, payload: message }, 'application log');
  }
}
