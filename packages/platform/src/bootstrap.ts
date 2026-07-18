import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { HttpMetricsMiddleware } from './metrics';
import { StructuredLogger } from './logger';
import { TraceMiddleware } from './tracing';

export async function configureHttpApplication(app: INestApplication, serviceName: string): Promise<void> {
  process.env.SERVICE_NAME = serviceName;
  app.useLogger(app.get(StructuredLogger));
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const trace = app.get(TraceMiddleware);
  const metrics = app.get(HttpMetricsMiddleware);
  app.use(trace.use.bind(trace));
  app.use(metrics.use.bind(metrics));
}
