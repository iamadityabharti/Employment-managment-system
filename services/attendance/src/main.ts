import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { AttendanceModule } from './attendance.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AttendanceModule, { bufferLogs: true });
  await configureHttpApplication(app, 'attendance-service');
  await app.listen(Number(process.env.PORT ?? 3003), '0.0.0.0');
}

void bootstrap();
