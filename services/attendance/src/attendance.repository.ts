import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '@atlas/platform';
import type { LeaveState, LeaveType } from '@atlas/contracts';

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  clock_in_at: Date;
  clock_out_at: Date | null;
  worked_minutes: number | null;
  created_at: Date;
}

export interface LeaveRequestRecord {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  starts_on: string;
  ends_on: string;
  days: number;
  state: LeaveState;
  reason: string | null;
  submitted_at: Date;
  updated_at: Date;
}

export interface LeaveTransitionRecord {
  id: string;
  leave_request_id: string;
  from_state: LeaveState;
  to_state: LeaveState;
  actor_id: string | null;
  reason: string | null;
  occurred_at: Date;
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly database: DatabaseService) {}

  // ── Clock records ─────────────────────────────────────────────

  async findOpenSession(employeeId: string): Promise<AttendanceRecord | undefined> {
    const result = await this.database.query<AttendanceRecord>(
      `SELECT * FROM attendance_records
       WHERE employee_id = $1 AND clock_out_at IS NULL
       ORDER BY clock_in_at DESC LIMIT 1`,
      [employeeId]
    );
    return result.rows[0];
  }

  async insertClockIn(client: PoolClient, id: string, employeeId: string): Promise<AttendanceRecord> {
    const result = await client.query<AttendanceRecord>(
      `INSERT INTO attendance_records (id, employee_id, clock_in_at)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [id, employeeId]
    );
    return result.rows[0];
  }

  async clockOut(client: PoolClient, id: string): Promise<AttendanceRecord> {
    const result = await client.query<AttendanceRecord>(
      `UPDATE attendance_records
       SET clock_out_at = NOW(),
           worked_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in_at))::INTEGER / 60
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  // ── Leave requests ────────────────────────────────────────────

  async findLeaveRequests(filters?: { employeeId?: string; state?: LeaveState }): Promise<LeaveRequestRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.employeeId) {
      conditions.push(`employee_id = $${idx++}`);
      values.push(filters.employeeId);
    }
    if (filters?.state) {
      conditions.push(`state = $${idx++}`);
      values.push(filters.state);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.database.query<LeaveRequestRecord>(
      `SELECT * FROM leave_requests ${where} ORDER BY submitted_at DESC`,
      values
    );
    return result.rows;
  }

  async findLeaveById(id: string): Promise<LeaveRequestRecord | undefined> {
    const result = await this.database.query<LeaveRequestRecord>(
      'SELECT * FROM leave_requests WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  async findLeaveByIdForUpdate(client: PoolClient, id: string): Promise<LeaveRequestRecord | undefined> {
    const result = await client.query<LeaveRequestRecord>(
      'SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE',
      [id]
    );
    return result.rows[0];
  }

  async insertLeaveRequest(
    client: PoolClient,
    record: Omit<LeaveRequestRecord, 'submitted_at' | 'updated_at'>
  ): Promise<LeaveRequestRecord> {
    const result = await client.query<LeaveRequestRecord>(
      `INSERT INTO leave_requests (id, employee_id, leave_type, starts_on, ends_on, days, state, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [record.id, record.employee_id, record.leave_type, record.starts_on, record.ends_on, record.days, record.state, record.reason]
    );
    return result.rows[0];
  }

  async updateLeaveState(client: PoolClient, id: string, state: LeaveState): Promise<void> {
    await client.query(
      'UPDATE leave_requests SET state = $1, updated_at = NOW() WHERE id = $2',
      [state, id]
    );
  }

  async insertTransition(
    client: PoolClient,
    record: Omit<LeaveTransitionRecord, 'occurred_at'>
  ): Promise<void> {
    await client.query(
      `INSERT INTO leave_transitions (id, leave_request_id, from_state, to_state, actor_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [record.id, record.leave_request_id, record.from_state, record.to_state, record.actor_id, record.reason]
    );
  }

  async findTransitions(leaveRequestId: string): Promise<LeaveTransitionRecord[]> {
    const result = await this.database.query<LeaveTransitionRecord>(
      'SELECT * FROM leave_transitions WHERE leave_request_id = $1 ORDER BY occurred_at',
      [leaveRequestId]
    );
    return result.rows;
  }
}
