import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { GatewayModule } from './gateway.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  await configureHttpApplication(app, 'gateway');
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
