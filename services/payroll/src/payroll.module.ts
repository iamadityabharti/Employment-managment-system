import { Module } from '@nestjs/common';
import { CoreModule, DatabaseModule, OutboxModule, RabbitMqModule } from '@atlas/platform';
import { PayrollController } from './payroll.controller';
import { PayrollConsumer } from './payroll.consumer';
import { PayrollRepository } from './payroll.repository';
import { PayrollSchemaBootstrap } from './payroll.schema';
import { PayrollService } from './payroll.service';

@Module({
  imports: [CoreModule, DatabaseModule, RabbitMqModule, OutboxModule],
  controllers: [PayrollController],
  providers: [
    PayrollService,
    PayrollRepository,
    PayrollSchemaBootstrap,
    PayrollConsumer
  ]
})
export class PayrollModule {}
