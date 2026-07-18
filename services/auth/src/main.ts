import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { AuthModule } from './auth.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AuthModule, { bufferLogs: true });
  await configureHttpApplication(app, 'auth-service');
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
