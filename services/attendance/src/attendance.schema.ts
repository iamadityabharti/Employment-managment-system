import { Injectable, OnModuleInit } from '@nestjs/common';
import { createReliabilityTables, DatabaseService } from '@atlas/platform';

@Injectable()
export class AttendanceSchemaBootstrap implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id UUID PRIMARY KEY,
        employee_id UUID NOT NULL,
        clock_in_at TIMESTAMPTZ NOT NULL,
        clock_out_at TIMESTAMPTZ,
        worked_minutes INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS attendance_employee_idx ON attendance_records (employee_id);
      CREATE INDEX IF NOT EXISTS attendance_clock_in_idx ON attendance_records (clock_in_at DESC);

      CREATE TABLE IF NOT EXISTS leave_requests (
        id UUID PRIMARY KEY,
        employee_id UUID NOT NULL,
        leave_type TEXT NOT NULL CHECK (leave_type IN ('ANNUAL', 'SICK', 'UNPAID')),
        starts_on DATE NOT NULL,
        ends_on DATE NOT NULL,
        days INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'Pending'
          CHECK (state IN ('Pending', 'ManagerReview', 'HRReview', 'Approved', 'Rejected')),
        reason TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS leave_employee_idx ON leave_requests (employee_id);
      CREATE INDEX IF NOT EXISTS leave_state_idx ON leave_requests (state);

      CREATE TABLE IF NOT EXISTS leave_transitions (
        id UUID PRIMARY KEY,
        leave_request_id UUID NOT NULL REFERENCES leave_requests(id),
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor_id UUID,
        reason TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS leave_transitions_request_idx ON leave_transitions (leave_request_id);
    `);
    await createReliabilityTables(this.database);
  }
}
