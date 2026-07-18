import type {
  EmployeeSummary,
  LeaveState,
  LeaveType,
  PayrollProjectionStatus,
  Role
} from '@atlas/contracts';

export type { EmployeeSummary, LeaveState, LeaveType, PayrollProjectionStatus, Role };

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: Role[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken?: string;
  token?: string;
  user?: Partial<SessionUser> & { sub?: string };
  data?: LoginResponse;
}

export interface LeaveTransition {
  id?: string;
  from: LeaveState;
  to: LeaveState;
  actorId?: string;
  actorName?: string;
  reason?: string;
  occurredAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  employee?: Pick<EmployeeSummary, 'id' | 'firstName' | 'lastName' | 'department' | 'title'>;
  leaveType: LeaveType;
  startsOn: string;
  endsOn: string;
  days: number;
  state: LeaveState;
  reason?: string;
  submittedAt?: string;
  updatedAt?: string;
  transitions?: LeaveTransition[];
  payrollProjection?: PayrollProjectionStatus;
}

export interface PayrollProjection extends PayrollProjectionStatus {
  employeeId?: string;
  leaveDaysApplied?: number;
  lastEventId?: string;
  updatedAt?: string;
  message?: string;
}

export interface PayrollRun {
  id: string;
  employeeId: string;
  employeeName?: string;
  periodStart: string;
  periodEnd: string;
  grossCents?: number;
  deductionsCents?: number;
  netCents?: number;
  status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt?: string;
  processedAt?: string;
  payslipId?: string;
}

export interface CollectionResponse<T> {
  data?: T[];
  items?: T[];
  results?: T[];
}
