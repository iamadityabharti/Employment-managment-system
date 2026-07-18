import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from '@atlas/platform';
import { ProxyMiddleware } from './proxy.middleware';
import { RateLimiter } from './rate-limiter';

/**
 * API Gateway module.
 *
 * The gateway is intentionally thin:
 * - Verifies JWT access tokens (via CoreModule's JwtAuthGuard — used by downstream services)
 * - Propagates trace IDs for distributed tracing
 * - Rate-limits by client IP via Redis
 * - Reverse-proxies to downstream services
 *
 * It does NOT own any business data or domain logic.
 */
@Module({
  imports: [CoreModule],
  providers: [ProxyMiddleware, RateLimiter]
})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply proxy middleware to all routes except health/metrics (handled by CoreModule)
    consumer
      .apply(ProxyMiddleware)
      .exclude('health/(.*)', 'metrics')
      .forRoutes('*');
  }
}
