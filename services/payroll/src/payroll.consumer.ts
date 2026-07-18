import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DomainEvent, LeaveEventData } from '@atlas/contracts';
import {
  DatabaseService,
  InboxService,
  RabbitMqService,
  StructuredLogger
} from '@atlas/platform';
import { PayrollRepository } from './payroll.repository';

/**
 * Payroll event consumer.
 *
 * Subscribes to leave and attendance events and maintains a leave-balance
 * projection. Uses the inbox pattern: before processing any event, we
 * attempt to insert (consumer_name, event_id) into the inbox table.
 * If the row already exists (ON CONFLICT DO NOTHING), the event was
 * already processed — we skip it, making redelivery harmless.
 */
@Injectable()
export class PayrollConsumer implements OnModuleInit {
  constructor(
    private readonly broker: RabbitMqService,
    private readonly database: DatabaseService,
    private readonly inbox: InboxService,
    private readonly repository: PayrollRepository,
    private readonly logger: StructuredLogger
  ) {}

  async onModuleInit(): Promise<void> {
    await this.broker.subscribe(
      'payroll.leave-events',
      ['leave.approved.v1', 'leave.transitioned.v1'],
      async (event) => this.handleLeaveEvent(event)
    );

    await this.broker.subscribe(
      'payroll.employee-events',
      ['employee.created.v1'],
      async (event) => this.handleEmployeeCreated(event)
    );

    this.logger.log('Payroll consumers initialized', 'PayrollConsumer');
  }

  private async handleLeaveEvent(event: DomainEvent): Promise<void> {
    await this.database.transaction(async (client) => {
      // Inbox check: skip if already processed
      const isNew = await this.inbox.accept(client, 'payroll-leave', event.eventId);
      if (!isNew) {
        this.logger.log(
          `Duplicate event ${event.eventId} (${event.type}) — skipping`,
          'PayrollConsumer'
        );
        return;
      }

      const data = event.data as unknown as LeaveEventData;

      if (event.type === 'leave.approved.v1') {
        // Update the leave balance projection
        await this.repository.upsertLeaveProjection(client, {
          id: randomUUID(),
          leave_request_id: data.leaveRequestId,
          employee_id: data.employeeId,
          leave_type: data.leaveType ?? 'ANNUAL',
          days: data.days ?? 0,
          source_event_id: event.eventId
        });

        this.logger.log(
          `Leave projection synchronized: ${data.leaveRequestId} (${data.days} days)`,
          'PayrollConsumer'
        );
      }
    });
  }

  private async handleEmployeeCreated(event: DomainEvent): Promise<void> {
    await this.database.transaction(async (client) => {
      const isNew = await this.inbox.accept(client, 'payroll-employee', event.eventId);
      if (!isNew) {
        return;
      }

      const data = event.data as { employeeId: string };

      // Create a default compensation record for new employees
      const existing = await this.repository.findCompensation(data.employeeId);
      if (!existing) {
        await client.query(
          `INSERT INTO compensation (id, employee_id, annual_salary_cents, currency)
           VALUES ($1, $2, 7200000, 'USD')
           ON CONFLICT (employee_id) DO NOTHING`,
          [randomUUID(), data.employeeId]
        );
        this.logger.log(
          `Default compensation created for employee ${data.employeeId}`,
          'PayrollConsumer'
        );
      }
    });
  }
}
