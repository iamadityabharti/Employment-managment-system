export const ROLES = ['Admin', 'Manager', 'Employee'] as const;
export type Role = (typeof ROLES)[number];

export const LEAVE_STATES = [
  'Pending',
  'ManagerReview',
  'HRReview',
  'Approved',
  'Rejected'
] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];

export type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID';

export interface JwtClaims {
  sub: string;
  email: string;
  roles: Role[];
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface EmployeeSummary {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  department: string;
  managerId?: string | null;
  path: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PayrollProjectionStatus {
  leaveRequestId: string;
  status: 'pending' | 'synchronized' | 'failed';
  appliedAt?: string;
}
