import { Module } from '@nestjs/common';
import { CoreModule, DatabaseModule, OutboxModule, RabbitMqModule } from '@atlas/platform';
import { EmployeeController } from './employee.controller';
import { EmployeeRepository } from './employee.repository';
import { EmployeeSchemaBootstrap } from './employee.schema';
import { EmployeeService } from './employee.service';

@Module({
  imports: [CoreModule, DatabaseModule, RabbitMqModule, OutboxModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeRepository, EmployeeSchemaBootstrap]
})
export class EmployeeModule {}
