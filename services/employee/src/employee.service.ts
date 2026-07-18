import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createDomainEvent } from '@atlas/contracts';
import { DatabaseService, OutboxService, getTraceContext } from '@atlas/platform';
import { EmployeeRepository, type EmployeeRecord } from './employee.repository';

function toSummary(record: EmployeeRecord) {
  return {
    id: record.id,
    employeeNumber: record.employee_number,
    firstName: record.first_name,
    lastName: record.last_name,
    email: record.email,
    title: record.title,
    department: record.department,
    managerId: record.manager_id,
    path: record.path,
    status: record.status
  };
}

@Injectable()
export class EmployeeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: EmployeeRepository,
    private readonly outbox: OutboxService
  ) {}

  async listAll() {
    const records = await this.repository.findAll();
    return records.map(toSummary);
  }

  async getById(id: string) {
    const record = await this.repository.findById(id);
    if (!record) {
      throw new NotFoundException(`Employee ${id} not found`);
    }
    return toSummary(record);
  }

  async getDirectReports(id: string) {
    const employee = await this.repository.findById(id);
    if (!employee) {
      throw new NotFoundException(`Employee ${id} not found`);
    }
    const reports = await this.repository.findDirectReports(id);
    return reports.map(toSummary);
  }

  async getOrgChart(id: string) {
    const employee = await this.repository.findById(id);
    if (!employee) {
      throw new NotFoundException(`Employee ${id} not found`);
    }
    const descendants = await this.repository.findDescendants(employee.path);
    return {
      root: toSummary(employee),
      descendants: descendants.map(toSummary)
    };
  }

  async create(input: {
    firstName: string;
    lastName: string;
    email: string;
    title?: string;
    department?: string;
    managerId?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const id = randomUUID();

    return this.database.transaction(async (client) => {
      // Check for duplicate email
      const existing = await this.repository.findByEmail(input.email);
      if (existing) {
        throw new ConflictException('An employee with that email already exists');
      }

      // Generate employee number
      const employeeNumber = await this.repository.generateEmployeeNumber();

      // Compute ltree path
      let path: string;
      if (input.managerId) {
        const manager = await this.repository.findById(input.managerId);
        if (!manager) {
          throw new NotFoundException(`Manager ${input.managerId} not found`);
        }
        const label = `emp_${employeeNumber.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
        path = `${manager.path}.${label}`;
      } else {
        path = 'root';
      }

      const record: Omit<EmployeeRecord, 'created_at' | 'updated_at'> = {
        id,
        employee_number: employeeNumber,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email.toLowerCase(),
        title: input.title ?? '',
        department: input.department ?? '',
        manager_id: input.managerId ?? null,
        path,
        status: input.status ?? 'ACTIVE'
      };

      await this.repository.insert(client, record);

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'employee.created.v1',
          producer: 'employee-service',
          aggregate: { type: 'employee', id },
          traceId: getTraceContext().traceId,
          data: {
            employeeId: id,
            employeeNumber,
            email: input.email.toLowerCase(),
            firstName: input.firstName,
            lastName: input.lastName,
            managerId: input.managerId ?? null,
            path,
            department: input.department ?? '',
            title: input.title ?? ''
          }
        })
      );

      return toSummary({ ...record, created_at: new Date(), updated_at: new Date() });
    });
  }

  async update(id: string, input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    title?: string;
    department?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return this.database.transaction(async (client) => {
      const updated = await this.repository.update(client, id, {
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        title: input.title,
        department: input.department,
        status: input.status
      });
      if (!updated) {
        throw new NotFoundException(`Employee ${id} not found`);
      }

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'employee.updated.v1',
          producer: 'employee-service',
          aggregate: { type: 'employee', id },
          traceId: getTraceContext().traceId,
          data: {
            employeeId: id,
            ...input
          }
        })
      );

      return toSummary(updated);
    });
  }

  async changeManager(employeeId: string, newManagerId: string | null) {
    return this.database.transaction(async (client) => {
      let newManagerPath: string | null = null;
      if (newManagerId) {
        const manager = await this.repository.findById(newManagerId);
        if (!manager) {
          throw new NotFoundException(`Manager ${newManagerId} not found`);
        }
        newManagerPath = manager.path;
      }

      const { employee, previousManagerId } = await this.repository.changeManager(
        client,
        employeeId,
        newManagerId,
        newManagerPath
      );

      await this.outbox.enqueue(
        client,
        createDomainEvent({
          type: 'employee.manager-changed.v1',
          producer: 'employee-service',
          aggregate: { type: 'employee', id: employeeId },
          traceId: getTraceContext().traceId,
          data: {
            employeeId,
            previousManagerId,
            managerId: newManagerId,
            path: employee.path
          }
        })
      );

      return toSummary(employee);
    });
  }
}
