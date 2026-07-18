import { Injectable, OnModuleInit } from '@nestjs/common';
import { createReliabilityTables, DatabaseService } from '@atlas/platform';

@Injectable()
export class EmployeeSchemaBootstrap implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id UUID PRIMARY KEY,
        employee_number TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        manager_id UUID REFERENCES employees(id),
        path LTREE NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS employees_path_gist_idx ON employees USING GIST (path);
      CREATE INDEX IF NOT EXISTS employees_path_btree_idx ON employees USING BTREE (path);
      CREATE INDEX IF NOT EXISTS employees_manager_id_idx ON employees (manager_id);
      CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department);
      CREATE INDEX IF NOT EXISTS employees_status_idx ON employees (status);
    `);
    await createReliabilityTables(this.database);
    await this.seedDemoEmployees();
  }

  private async seedDemoEmployees(): Promise<void> {
    if (process.env.SEED_DEMO_DATA === 'false') {
      return;
    }
    const existing = await this.database.query(
      "SELECT id FROM employees WHERE employee_number = 'EMP-001'"
    );
    if (existing.rowCount) {
      return;
    }
    // Seed a small org tree for development / demonstration
    const ceoId = '00000000-0000-4000-8000-000000000001';
    const vpEngId = '00000000-0000-4000-8000-000000000002';
    const devLeadId = '00000000-0000-4000-8000-000000000003';

    await this.database.query(
      `INSERT INTO employees (id, employee_number, first_name, last_name, email, title, department, manager_id, path)
       VALUES
         ($1, 'EMP-001', 'Alice',  'Morgan',   'alice@atlas.local',  'CEO',              'Executive',   NULL, 'root'),
         ($2, 'EMP-002', 'Bob',    'Chen',     'bob@atlas.local',    'VP Engineering',   'Engineering', $1,   'root.emp_002'),
         ($3, 'EMP-003', 'Carol',  'Diaz',     'carol@atlas.local',  'Dev Lead',         'Engineering', $2,   'root.emp_002.emp_003'),
         ($4, 'EMP-004', 'David',  'Kim',      'david@atlas.local',  'Software Engineer','Engineering', $3,   'root.emp_002.emp_003.emp_004'),
         ($5, 'EMP-005', 'Eve',    'Nakamura', 'eve@atlas.local',    'HR Manager',       'Human Resources', $1, 'root.emp_005')
       ON CONFLICT (employee_number) DO NOTHING`,
      [
        ceoId,
        vpEngId,
        devLeadId,
        '00000000-0000-4000-8000-000000000004',
        '00000000-0000-4000-8000-000000000005'
      ]
    );
  }
}
