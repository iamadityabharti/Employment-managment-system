import { Injectable, NestMiddleware } from '@nestjs/common';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import type { NextFunction, Request, Response } from 'express';
import { getTraceContext, StructuredLogger } from '@atlas/platform';
import { RateLimiter } from './rate-limiter';

/**
 * Route definitions: path prefix → target service URL.
 * The gateway strips no prefixes — downstream services own their route namespaces.
 */
const ROUTE_TABLE: Array<{ prefix: string; target: string; envVar: string }> = [
  { prefix: '/auth',          target: 'http://auth:3001',          envVar: 'AUTH_SERVICE_URL' },
  { prefix: '/employees',     target: 'http://employee:3002',      envVar: 'EMPLOYEE_SERVICE_URL' },
  { prefix: '/attendance',    target: 'http://attendance:3003',     envVar: 'ATTENDANCE_SERVICE_URL' },
  { prefix: '/payroll',       target: 'http://payroll:3004',        envVar: 'PAYROLL_SERVICE_URL' },
  { prefix: '/notifications', target: 'http://notification:3005',   envVar: 'NOTIFICATION_SERVICE_URL' },
];

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  // createProxyMiddleware returns a Node http handler typed against
  // IncomingMessage/ServerResponse; we cast to the Express-style signature
  // NestMiddleware expects. The runtime contract is compatible (Express's
  // Request/Response extend the Node types).
  private readonly proxies: Array<{ prefix: string; handler: (req: Request, res: Response, next: NextFunction) => void }> = [];

  constructor(
    private readonly rateLimiter: RateLimiter,
    private readonly logger: StructuredLogger
  ) {
    for (const route of ROUTE_TABLE) {
      const target = process.env[route.envVar] ?? route.target;
      const proxyOptions: Options = {
        target,
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        on: {
          proxyReq: (proxyReq, req) => {
            // Propagate distributed tracing headers
            const ctx = getTraceContext();
            proxyReq.setHeader('x-trace-id', ctx.traceId);
            proxyReq.setHeader('x-correlation-id', ctx.correlationId);

            // Forward the original client IP for downstream rate limiters
            const clientIp = (req as Request).ip ?? (req as Request).socket.remoteAddress ?? 'unknown';
            proxyReq.setHeader('x-forwarded-for', clientIp);
          },
          error: (err, _req, res) => {
            this.logger.error(err, undefined, `Proxy error → ${target}`);
            if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
              (res as Response).status(502).json({
                statusCode: 502,
                message: `Service at ${route.prefix} is temporarily unavailable`,
                traceId: getTraceContext().traceId
              });
            }
          }
        }
      };
      this.proxies.push({
        prefix: route.prefix,
        handler: createProxyMiddleware(proxyOptions) as (req: Request, res: Response, next: NextFunction) => void
      });
      this.logger.log(`Route: ${route.prefix}/** → ${target}`, 'ProxyMiddleware');
    }
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Apply rate limiting based on IP
    const clientKey = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    await this.rateLimiter.assertAllowed(clientKey);

    // Find the matching proxy
    for (const { prefix, handler } of this.proxies) {
      if (req.path.startsWith(prefix)) {
        return handler(req, res, next);
      }
    }

    // No proxy matched — let NestJS handle it (health, metrics, 404)
    next();
  }
}
