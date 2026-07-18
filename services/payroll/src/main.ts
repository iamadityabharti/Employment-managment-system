import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { PayrollModule } from './payroll.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(PayrollModule, { bufferLogs: true });
  await configureHttpApplication(app, 'payroll-service');
  await app.listen(Number(process.env.PORT ?? 3004), '0.0.0.0');
}

void bootstrap();
