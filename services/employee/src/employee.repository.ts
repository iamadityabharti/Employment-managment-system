import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '@atlas/platform';

export interface EmployeeRecord {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string;
  department: string;
  manager_id: string | null;
  path: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class EmployeeRepository {
  constructor(private readonly database: DatabaseService) {}

  async findAll(): Promise<EmployeeRecord[]> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees
       ORDER BY path`
    );
    return result.rows;
  }

  async findById(id: string): Promise<EmployeeRecord | undefined> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  async findByEmail(email: string): Promise<EmployeeRecord | undefined> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees WHERE email = $1`,
      [email.toLowerCase()]
    );
    return result.rows[0];
  }

  /**
   * Find all direct and indirect reports using ltree descendant operator.
   * This is O(log n) with the GiST index — no recursive CTE needed.
   */
  async findDescendants(path: string): Promise<EmployeeRecord[]> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees
       WHERE path <@ $1::ltree AND path != $1::ltree
       ORDER BY path`,
      [path]
    );
    return result.rows;
  }

  /**
   * Find direct reports only (children one level below).
   */
  async findDirectReports(managerId: string): Promise<EmployeeRecord[]> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees WHERE manager_id = $1
       ORDER BY last_name, first_name`,
      [managerId]
    );
    return result.rows;
  }

  /**
   * Find the chain of ancestors (for org-chart upward traversal).
   */
  async findAncestors(path: string): Promise<EmployeeRecord[]> {
    const result = await this.database.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees
       WHERE $1::ltree <@ path AND path != $1::ltree
       ORDER BY path`,
      [path]
    );
    return result.rows;
  }

  async insert(client: PoolClient, employee: Omit<EmployeeRecord, 'created_at' | 'updated_at'>): Promise<void> {
    await client.query(
      `INSERT INTO employees (id, employee_number, first_name, last_name, email, title, department, manager_id, path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::ltree, $10)`,
      [
        employee.id,
        employee.employee_number,
        employee.first_name,
        employee.last_name,
        employee.email.toLowerCase(),
        employee.title,
        employee.department,
        employee.manager_id,
        employee.path,
        employee.status
      ]
    );
  }

  async update(
    client: PoolClient,
    id: string,
    fields: Partial<Pick<EmployeeRecord, 'first_name' | 'last_name' | 'title' | 'department' | 'status' | 'email'>>
  ): Promise<EmployeeRecord | undefined> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(key === 'email' ? (value as string).toLowerCase() : value);
        paramIndex++;
      }
    }

    values.push(id);
    const result = await client.query<EmployeeRecord>(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, employee_number, first_name, last_name, email, title,
                 department, manager_id, path::TEXT, status, created_at, updated_at`,
      values
    );
    return result.rows[0];
  }

  /**
   * Re-parent an employee's subtree when their manager changes.
   * Updates the employee's manager_id and re-computes all ltree paths in the subtree.
   */
  async changeManager(
    client: PoolClient,
    employeeId: string,
    newManagerId: string | null,
    newManagerPath: string | null
  ): Promise<{ employee: EmployeeRecord; previousManagerId: string | null }> {
    const current = (await client.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees WHERE id = $1 FOR UPDATE`,
      [employeeId]
    )).rows[0];

    if (!current) {
      throw new Error(`Employee ${employeeId} not found`);
    }

    const previousManagerId = current.manager_id;
    const employeeLabel = `emp_${current.employee_number.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    const newPath = newManagerPath ? `${newManagerPath}.${employeeLabel}` : employeeLabel;
    const oldPath = current.path;

    // Update the employee's manager and path
    await client.query(
      `UPDATE employees SET manager_id = $1, path = $2::ltree, updated_at = NOW() WHERE id = $3`,
      [newManagerId, newPath, employeeId]
    );

    // Re-path all descendants: replace the old prefix with the new prefix
    await client.query(
      `UPDATE employees
       SET path = ($1::ltree || subpath(path, nlevel($2::ltree)))::ltree,
           updated_at = NOW()
       WHERE path <@ $2::ltree AND id != $3`,
      [newPath, oldPath, employeeId]
    );

    const updated = (await client.query<EmployeeRecord>(
      `SELECT id, employee_number, first_name, last_name, email, title,
              department, manager_id, path::TEXT, status, created_at, updated_at
       FROM employees WHERE id = $1`,
      [employeeId]
    )).rows[0];

    return { employee: updated, previousManagerId };
  }

  async generateEmployeeNumber(): Promise<string> {
    const result = await this.database.query<{ max_num: string }>(
      `SELECT employee_number AS max_num FROM employees
       ORDER BY employee_number DESC LIMIT 1`
    );
    if (!result.rows[0]) {
      return 'EMP-001';
    }
    const lastNum = parseInt(result.rows[0].max_num.replace('EMP-', ''), 10);
    return `EMP-${String(lastNum + 1).padStart(3, '0')}`;
  }
}
