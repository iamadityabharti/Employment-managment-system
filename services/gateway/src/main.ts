import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { GatewayModule } from './gateway.module';
import { ProxyMiddleware } from './proxy.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  await configureHttpApplication(app, 'gateway');

  const proxy = app.get(ProxyMiddleware);
  app.use(proxy.handle);

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
