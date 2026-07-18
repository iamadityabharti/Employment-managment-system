import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import type { LeaveState } from '@atlas/contracts';
import { JwtAuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@atlas/platform';
import { AttendanceService } from './attendance.service';
import { ClockInDto, ClockOutDto, CreateLeaveRequestDto, TransitionLeaveDto } from './dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('clock-in')
  clockIn(@Body() body: ClockInDto) {
    return this.attendance.clockIn(body.employeeId);
  }

  @Post('clock-out')
  clockOut(@Body() body: ClockOutDto) {
    return this.attendance.clockOut(body.employeeId);
  }

  @Get('leaves')
  listLeaves(
    @Query('employeeId') employeeId?: string,
    @Query('state') state?: LeaveState
  ) {
    return this.attendance.listLeaves({ employeeId, state });
  }

  @Get('leaves/:id')
  getLeave(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.getLeave(id);
  }

  @Post('leaves')
  createLeave(@Body() body: CreateLeaveRequestDto) {
    return this.attendance.createLeaveRequest({
      employeeId: body.employeeId,
      leaveType: body.leaveType,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      days: body.days,
      reason: body.reason
    });
  }

  @Post('leaves/:id/transition')
  @Roles('Manager', 'Admin')
  transitionLeave(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionLeaveDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.attendance.transitionLeave(
      id,
      body.to,
      request.user!.sub,
      request.user!.roles,
      body.reason
    );
  }
}
