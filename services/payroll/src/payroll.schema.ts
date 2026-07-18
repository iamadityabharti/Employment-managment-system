import { Injectable, OnModuleInit } from '@nestjs/common';
import { createReliabilityTables, DatabaseService } from '@atlas/platform';

@Injectable()
export class PayrollSchemaBootstrap implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS compensation (
        id UUID PRIMARY KEY,
        employee_id UUID NOT NULL UNIQUE,
        annual_salary_cents BIGINT NOT NULL DEFAULT 7200000,
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pay_runs (
        id UUID PRIMARY KEY,
        employee_id UUID NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        gross_cents BIGINT,
        deductions_cents BIGINT DEFAULT 0,
        net_cents BIGINT,
        status TEXT NOT NULL DEFAULT 'REQUESTED'
          CHECK (status IN ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED')),
        idempotency_key TEXT,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, period_start, period_end)
      );
      CREATE INDEX IF NOT EXISTS pay_runs_employee_idx ON pay_runs (employee_id);
      CREATE INDEX IF NOT EXISTS pay_runs_status_idx ON pay_runs (status);

      CREATE TABLE IF NOT EXISTS payslips (
        id UUID PRIMARY KEY,
        pay_run_id UUID NOT NULL REFERENCES pay_runs(id),
        employee_id UUID NOT NULL,
        storage_key TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS payslips_pay_run_idx ON payslips (pay_run_id);

      CREATE TABLE IF NOT EXISTS leave_balance_projection (
        id UUID PRIMARY KEY,
        leave_request_id UUID NOT NULL UNIQUE,
        employee_id UUID NOT NULL,
        leave_type TEXT NOT NULL,
        days INTEGER NOT NULL,
        source_event_id UUID NOT NULL,
        status TEXT NOT NULL DEFAULT 'synchronized'
          CHECK (status IN ('pending', 'synchronized', 'failed')),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS lbp_employee_idx ON leave_balance_projection (employee_id);
    `);
    await createReliabilityTables(this.database);
    await this.seedDemoCompensation();
  }

  private async seedDemoCompensation(): Promise<void> {
    if (process.env.SEED_DEMO_DATA === 'false') {
      return;
    }
    // Seed compensation for demo employees if they don't already exist
    await this.database.query(`
      INSERT INTO compensation (id, employee_id, annual_salary_cents, currency)
      VALUES
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 15000000, 'USD'),
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 12000000, 'USD'),
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000003', 10000000, 'USD'),
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000004',  8000000, 'USD'),
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000005',  9500000, 'USD')
      ON CONFLICT (employee_id) DO NOTHING
    `);
  }
}
