import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import type { LeaveState, LeaveType } from '@atlas/contracts';

export class CreateLeaveRequestDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(['ANNUAL', 'SICK', 'UNPAID'])
  leaveType!: LeaveType;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;

  @IsInt()
  @Min(1)
  days!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class TransitionLeaveDto {
  @IsIn(['Pending', 'ManagerReview', 'HRReview', 'Approved', 'Rejected'])
  to!: LeaveState;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class ClockInDto {
  @IsUUID()
  employeeId!: string;
}

export class ClockOutDto {
  @IsUUID()
  employeeId!: string;
}
