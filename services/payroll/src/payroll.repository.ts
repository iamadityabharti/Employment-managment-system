import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '@atlas/platform';

export interface CompensationRecord {
  id: string;
  employee_id: string;
  annual_salary_cents: number;
  currency: string;
  effective_from: string;
}

export interface PayRunRecord {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  gross_cents: number | null;
  deductions_cents: number | null;
  net_cents: number | null;
  status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  idempotency_key: string | null;
  processed_at: Date | null;
  created_at: Date;
}

export interface PayslipRecord {
  id: string;
  pay_run_id: string;
  employee_id: string;
  storage_key: string;
  generated_at: Date;
}

export interface LeaveProjectionRecord {
  id: string;
  leave_request_id: string;
  employee_id: string;
  leave_type: string;
  days: number;
  source_event_id: string;
  status: 'pending' | 'synchronized' | 'failed';
  applied_at: Date;
}

@Injectable()
export class PayrollRepository {
  constructor(private readonly database: DatabaseService) {}

  async findCompensation(employeeId: string): Promise<CompensationRecord | undefined> {
    const result = await this.database.query<CompensationRecord>(
      'SELECT * FROM compensation WHERE employee_id = $1',
      [employeeId]
    );
    return result.rows[0];
  }

  async findPayRuns(filters?: { employeeId?: string }): Promise<PayRunRecord[]> {
    if (filters?.employeeId) {
      const result = await this.database.query<PayRunRecord>(
        'SELECT * FROM pay_runs WHERE employee_id = $1 ORDER BY created_at DESC',
        [filters.employeeId]
      );
      return result.rows;
    }
    const result = await this.database.query<PayRunRecord>(
      'SELECT * FROM pay_runs ORDER BY created_at DESC'
    );
    return result.rows;
  }

  async findPayRunByPeriod(
    employeeId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<PayRunRecord | undefined> {
    const result = await this.database.query<PayRunRecord>(
      `SELECT * FROM pay_runs
       WHERE employee_id = $1 AND period_start = $2 AND period_end = $3`,
      [employeeId, periodStart, periodEnd]
    );
    return result.rows[0];
  }

  async findPayRunById(id: string): Promise<PayRunRecord | undefined> {
    const result = await this.database.query<PayRunRecord>(
      'SELECT * FROM pay_runs WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  async insertPayRun(client: PoolClient, record: {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    idempotency_key: string | null;
  }): Promise<PayRunRecord> {
    const result = await client.query<PayRunRecord>(
      `INSERT INTO pay_runs (id, employee_id, period_start, period_end, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'REQUESTED', $5)
       RETURNING *`,
      [record.id, record.employee_id, record.period_start, record.period_end, record.idempotency_key]
    );
    return result.rows[0];
  }

  async completePayRun(client: PoolClient, id: string, grossCents: number, deductionsCents: number, netCents: number): Promise<PayRunRecord> {
    const result = await client.query<PayRunRecord>(
      `UPDATE pay_runs
       SET status = 'COMPLETED', gross_cents = $2, deductions_cents = $3, net_cents = $4, processed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, grossCents, deductionsCents, netCents]
    );
    return result.rows[0];
  }

  async failPayRun(client: PoolClient, id: string): Promise<void> {
    await client.query(
      "UPDATE pay_runs SET status = 'FAILED', processed_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async insertPayslip(client: PoolClient, record: {
    id: string;
    pay_run_id: string;
    employee_id: string;
    storage_key: string;
  }): Promise<PayslipRecord> {
    const result = await client.query<PayslipRecord>(
      `INSERT INTO payslips (id, pay_run_id, employee_id, storage_key)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [record.id, record.pay_run_id, record.employee_id, record.storage_key]
    );
    return result.rows[0];
  }

  async findPayslip(payRunId: string): Promise<PayslipRecord | undefined> {
    const result = await this.database.query<PayslipRecord>(
      'SELECT * FROM payslips WHERE pay_run_id = $1',
      [payRunId]
    );
    return result.rows[0];
  }

  // ── Leave balance projection ──────────────────────────────────

  async upsertLeaveProjection(client: PoolClient, record: {
    id: string;
    leave_request_id: string;
    employee_id: string;
    leave_type: string;
    days: number;
    source_event_id: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO leave_balance_projection (id, leave_request_id, employee_id, leave_type, days, source_event_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'synchronized')
       ON CONFLICT (leave_request_id)
       DO UPDATE SET days = EXCLUDED.days, source_event_id = EXCLUDED.source_event_id, status = 'synchronized', applied_at = NOW()`,
      [record.id, record.leave_request_id, record.employee_id, record.leave_type, record.days, record.source_event_id]
    );
  }

  async findLeaveProjection(leaveRequestId: string): Promise<LeaveProjectionRecord | undefined> {
    const result = await this.database.query<LeaveProjectionRecord>(
      'SELECT * FROM leave_balance_projection WHERE leave_request_id = $1',
      [leaveRequestId]
    );
    return result.rows[0];
  }

  // ── Idempotency ──────────────────────────────────────────────

  async checkIdempotencyKey(scope: string, key: string): Promise<{ response_status: number; response_body: unknown } | undefined> {
    const result = await this.database.query<{ response_status: number; response_body: unknown }>(
      'SELECT response_status, response_body FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2',
      [scope, key]
    );
    return result.rows[0];
  }

  async saveIdempotencyRecord(client: PoolClient, scope: string, key: string, requestHash: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await client.query(
      `INSERT INTO idempotency_records (scope, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (scope, idempotency_key) DO NOTHING`,
      [scope, key, requestHash, responseStatus, JSON.stringify(responseBody)]
    );
  }
}
