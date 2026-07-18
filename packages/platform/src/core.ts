import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter';
import { StructuredLogger } from './logger';
import { HttpMetricsMiddleware, MetricsService, PlatformHealthController } from './metrics';
import { TraceMiddleware } from './tracing';
import { JwtAuthGuard, RolesGuard } from './auth';

@Global()
@Module({
  controllers: [PlatformHealthController],
  providers: [
    StructuredLogger,
    MetricsService,
    TraceMiddleware,
    HttpMetricsMiddleware,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_FILTER, useClass: HttpExceptionFilter }
  ],
  exports: [
    StructuredLogger,
    MetricsService,
    TraceMiddleware,
    HttpMetricsMiddleware,
    JwtAuthGuard,
    RolesGuard
  ]
})
export class CoreModule {}
