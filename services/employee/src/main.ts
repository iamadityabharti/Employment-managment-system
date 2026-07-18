import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { EmployeeModule } from './employee.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(EmployeeModule, { bufferLogs: true });
  await configureHttpApplication(app, 'employee-service');
  await app.listen(Number(process.env.PORT ?? 3002), '0.0.0.0');
}

void bootstrap();
