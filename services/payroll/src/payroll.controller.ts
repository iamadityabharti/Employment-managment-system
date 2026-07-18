import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '@atlas/platform';
import { PayrollService } from './payroll.service';
import { TriggerPayRunDto } from './dto';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('runs')
  listRuns(@Query('employeeId') employeeId?: string) {
    return this.payroll.listPayRuns(employeeId);
  }

  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getPayRun(id);
  }

  @Post('runs')
  @Roles('Admin')
  triggerRun(
    @Body() body: TriggerPayRunDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.payroll.triggerPayRun({
      employeeId: body.employeeId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      idempotencyKey
    });
  }

  @Get('projections/:leaveRequestId')
  getProjection(@Param('leaveRequestId', ParseUUIDPipe) leaveRequestId: string) {
    return this.payroll.getProjection(leaveRequestId);
  }
}
