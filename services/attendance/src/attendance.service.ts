import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException
} from '@nestjs/common';
import CircuitBreaker from 'opossum';
import {
  createDomainEvent,
  type LeaveState,
  type LeaveType,
  type Role
} from '@atlas/contracts';
import {
  DatabaseService,
  OutboxService,
  StructuredLogger,
  getTraceContext
} from '@atlas/platform';
import { AttendanceRepository } from './attendance.repository';
import { validateLeaveTransition, isTerminalState } from './leave-state-machine';

/**
 * Circuit breaker wraps the Employee Service HTTP lookup.
 * If Employee Service is down, the circuit opens and returns a degraded
 * response rather than cascading the failure to Attendance callers.
 */
function createEmployeeLookupBreaker(logger: StructuredLogger) {
  const employeeServiceUrl = process.env.EMPLOYEE_SERVICE_URL ?? 'http://employee:3002';

  const lookup = async (employeeId: string): Promise<{ id: string; email: string }> => {
    const response = await fetch(`${employeeServiceUrl}/employees/${employeeId}`, {
      headers: {
        'x-trace-id': getTraceContext().traceId,
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      throw new Error(`Employee lookup failed: ${response.status}`);
    }
    return response.json() as Promise<{ id: string; email: string }>;
  };

  const breaker = new CircuitBreaker(lookup, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 15000,
    volumeThreshold: 3,
    name: 'employee-lookup'
  });

  breaker.on('open', () => logger.warn('Circuit OPEN: Employee Service is unavailable', 'CircuitBreaker'));
  breaker.on('halfOpen', () => logger.log('Circuit HALF-OPEN: testing Employee Service', 'CircuitBreaker'));
  breaker.on('close', () => logger.log('Circuit CLOSED: Employee Service recovered', 'CircuitBreaker'));

  return breaker;
}

@Injectable()
export class AttendanceService implements OnModuleInit {
  private employeeBreaker!: CircuitBreaker<[string], { id: string; email: string }>;

  constructor(
    private readonly database: DatabaseService,
    private readonly repository: AttendanceRepository,
    private readonly outbox: OutboxService,
    private readonly logger: StructuredLogger
  ) {}

  onModuleInit(): void {
    this.employeeBreaker = createEmployeeLookupBreaker(this.logger);
  }

  // ── Clock in/out ──────────────────────────────────────────────

  async clockIn(employeeId: string) {
    await this.verifyEmployee(employeeId);

    const existing = await this.repository.findOpenSession(employeeId);
    if (existing) {
      throw new BadRequestException('Already clocked in. Clock out first.');
    }

    const id = randomUUID();
    return this.database.transaction(async (client) => {
      const record = await this.repository.insertClockIn(client, id, employeeId);
      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'attendance.clocked-in.v1',
          producer: 'attendance-service',
          aggregate: { type: 'attendance', id },
          traceId: getTraceContext().traceId,
          data: { attendanceId: id, employeeId, at: record.clock_in_at.toISOString() }
        })
      );
      return record;
    });
  }

  async clockOut(employeeId: string) {
    const session = await this.repository.findOpenSession(employeeId);
    if (!session) {
      throw new BadRequestException('Not clocked in.');
    }

    return this.database.transaction(async (client) => {
      const record = await this.repository.clockOut(client, session.id);
      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'attendance.clocked-out.v1',
          producer: 'attendance-service',
          aggregate: { type: 'attendance', id: session.id },
          traceId: getTraceContext().traceId,
          data: {
            attendanceId: session.id,
            employeeId,
            clockInAt: record.clock_in_at.toISOString(),
            clockOutAt: record.clock_out_at!.toISOString(),
            workedMinutes: record.worked_minutes ?? 0
          }
        })
      );
      return record;
    });
  }

  // ── Leave requests ────────────────────────────────────────────

  async listLeaves(filters?: { employeeId?: string; state?: LeaveState }) {
    return this.repository.findLeaveRequests(filters);
  }

  async getLeave(id: string) {
    const leave = await this.repository.findLeaveById(id);
    if (!leave) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }
    const transitions = await this.repository.findTransitions(id);
    return { ...leave, transitions };
  }

  async createLeaveRequest(input: {
    employeeId: string;
    leaveType: LeaveType;
    startsOn: string;
    endsOn: string;
    days: number;
    reason?: string;
  }) {
    await this.verifyEmployee(input.employeeId);

    const id = randomUUID();
    const state: LeaveState = 'Pending';

    return this.database.transaction(async (client) => {
      const record = await this.repository.insertLeaveRequest(client, {
        id,
        employee_id: input.employeeId,
        leave_type: input.leaveType,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        days: input.days,
        state,
        reason: input.reason ?? null
      });

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'leave.requested.v1',
          producer: 'attendance-service',
          aggregate: { type: 'leaveRequest', id },
          traceId: getTraceContext().traceId,
          data: {
            leaveRequestId: id,
            employeeId: input.employeeId,
            leaveType: input.leaveType,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            days: input.days,
            state
          }
        })
      );

      return record;
    });
  }

  async transitionLeave(
    leaveId: string,
    targetState: LeaveState,
    actorId: string,
    actorRoles: Role[],
    reason?: string
  ) {
    return this.database.transaction(async (client) => {
      const leave = await this.repository.findLeaveByIdForUpdate(client, leaveId);
      if (!leave) {
        throw new NotFoundException(`Leave request ${leaveId} not found`);
      }

      if (isTerminalState(leave.state)) {
        throw new BadRequestException(`Leave request is already ${leave.state}`);
      }

      // Validate the state machine transition + RBAC
      validateLeaveTransition(leave.state, targetState, actorRoles);

      const transitionId = randomUUID();
      await this.repository.updateLeaveState(client, leaveId, targetState);
      await this.repository.insertTransition(client, {
        id: transitionId,
        leave_request_id: leaveId,
        from_state: leave.state,
        to_state: targetState,
        actor_id: actorId,
        reason: reason ?? null
      });

      // Emit the appropriate event
      const eventType = targetState === 'Approved'
        ? 'leave.approved.v1' as const
        : targetState === 'Rejected'
          ? 'leave.rejected.v1' as const
          : 'leave.transitioned.v1' as const;

      const eventData: Record<string, unknown> = {
        leaveRequestId: leaveId,
        employeeId: leave.employee_id,
        leaveType: leave.leave_type,
        startsOn: leave.starts_on,
        endsOn: leave.ends_on,
        days: leave.days,
        state: targetState,
        from: leave.state,
        to: targetState,
        actorId
      };

      if (targetState === 'Approved') {
        eventData.approvedBy = actorId;
      } else if (targetState === 'Rejected') {
        eventData.rejectedBy = actorId;
        eventData.reason = reason ?? null;
      }

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: eventType,
          producer: 'attendance-service',
          aggregate: { type: 'leaveRequest', id: leaveId },
          traceId: getTraceContext().traceId,
          data: eventData
        })
      );

      return {
        ...leave,
        state: targetState,
        payrollProjection: targetState === 'Approved' ? { leaveRequestId: leaveId, status: 'pending' } : undefined
      };
    });
  }

  // ── Employee verification with circuit breaker ────────────────

  private async verifyEmployee(employeeId: string): Promise<void> {
    try {
      await this.employeeBreaker.fire(employeeId);
    } catch (error) {
      if (this.employeeBreaker.opened) {
        this.logger.warn(
          `Circuit open — skipping employee verification for ${employeeId}`,
          'AttendanceService'
        );
        return; // Graceful degradation: allow the operation without verification
      }
      throw new ServiceUnavailableException(
        `Could not verify employee: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
