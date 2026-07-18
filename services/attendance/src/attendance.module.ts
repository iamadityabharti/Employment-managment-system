import { Module } from '@nestjs/common';
import { CoreModule, DatabaseModule, OutboxModule, RabbitMqModule } from '@atlas/platform';
import { AttendanceController } from './attendance.controller';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceSchemaBootstrap } from './attendance.schema';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [CoreModule, DatabaseModule, RabbitMqModule, OutboxModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRepository, AttendanceSchemaBootstrap]
})
export class AttendanceModule {}
