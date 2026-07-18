import { Module } from '@nestjs/common';
import { CoreModule } from '@atlas/platform';
import { ProxyMiddleware } from './proxy.middleware';
import { RateLimiter } from './rate-limiter';

@Module({
  imports: [CoreModule],
  providers: [ProxyMiddleware, RateLimiter]
})
export class GatewayModule {}
