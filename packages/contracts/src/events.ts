import { randomUUID } from 'node:crypto';

export const EVENT_TYPES = [
  'auth.user-provisioned.v1',
  'employee.created.v1',
  'employee.updated.v1',
  'employee.manager-changed.v1',
  'attendance.clocked-in.v1',
  'attendance.clocked-out.v1',
  'leave.requested.v1',
  'leave.transitioned.v1',
  'leave.approved.v1',
  'leave.rejected.v1',
  'payroll.run.requested.v1',
  'payroll.run.processed.v1',
  'payslip.generated.v1',
  'notification.delivered.v1',
  'notification.failed.v1'
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EventAggregate {
  type: string;
  id: string;
}

export interface DomainEvent<TData = Record<string, unknown>, TType extends string = EventType> {
  eventId: string;
  type: TType;
  version: 1;
  occurredAt: string;
  producer: string;
  aggregate: EventAggregate;
  traceId: string;
  causationId?: string;
  data: TData;
}

export interface LeaveEventData {
  leaveRequestId: string;
  employeeId: string;
  leaveType: 'ANNUAL' | 'SICK' | 'UNPAID';
  startsOn: string;
  endsOn: string;
  days: number;
  state?: string;
  from?: string;
  to?: string;
  actorId?: string;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
}

export interface AttendanceEventData {
  attendanceId: string;
  employeeId: string;
  at?: string;
  clockInAt?: string;
  clockOutAt?: string;
  workedMinutes?: number;
}

export interface PayslipEventData {
  payslipId: string;
  payRunId: string;
  employeeId: string;
  storageKey: string;
}

export function createDomainEvent<TData>(
  input: Omit<DomainEvent<TData>, 'eventId' | 'occurredAt' | 'version'> &
    Partial<Pick<DomainEvent<TData>, 'eventId' | 'occurredAt' | 'version'>>
): DomainEvent<TData> {
  return {
    eventId: input.eventId ?? randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    version: 1,
    ...input
  };
}
