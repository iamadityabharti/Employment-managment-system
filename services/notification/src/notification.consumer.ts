import { Injectable, OnModuleInit } from '@nestjs/common';
import type { DomainEvent } from '@atlas/contracts';
import { RabbitMqService, StructuredLogger } from '@atlas/platform';
import { NotificationRepository, type NotificationDelivery } from './notification.repository';
import { WebSocketGatewayService } from './websocket.gateway';

/**
 * Notification event consumer.
 *
 * Subscribes to domain events from all services and delivers notifications
 * via mocked email and WebSocket push.
 *
 * Failure handling:
 * - Failed deliveries are nacked and routed to the dead-letter queue
 * - The DLQ (notification.leave-events.dlq, etc.) retains messages for
 *   manual inspection or automated replay
 * - Core service flows are never blocked by notification failures
 */
@Injectable()
export class NotificationConsumer implements OnModuleInit {
  constructor(
    private readonly broker: RabbitMqService,
    private readonly repository: NotificationRepository,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly logger: StructuredLogger
  ) {}

  async onModuleInit(): Promise<void> {
    // Subscribe to leave events
    await this.broker.subscribe(
      'notification.leave-events',
      ['leave.requested.v1', 'leave.transitioned.v1', 'leave.approved.v1', 'leave.rejected.v1'],
      async (event) => this.handleEvent(event)
    );

    // Subscribe to payroll events
    await this.broker.subscribe(
      'notification.payroll-events',
      ['payroll.run.processed.v1', 'payslip.generated.v1'],
      async (event) => this.handleEvent(event)
    );

    // Subscribe to employee events
    await this.broker.subscribe(
      'notification.employee-events',
      ['employee.created.v1'],
      async (event) => this.handleEvent(event)
    );

    this.logger.log('Notification consumers initialized', 'NotificationConsumer');
  }

  private async handleEvent(event: DomainEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const recipientId = (data.employeeId as string) ?? event.aggregate.id;

    const { subject, body } = this.buildNotificationContent(event);

    // ── Email delivery (mocked) ─────────────────────────────────
    await this.deliverWithRetry({
      event,
      recipientId,
      channel: 'email',
      subject,
      body
    });

    // ── WebSocket delivery ──────────────────────────────────────
    await this.deliverWithRetry({
      event,
      recipientId,
      channel: 'websocket',
      subject,
      body
    });
  }

  private async deliverWithRetry(input: {
    event: DomainEvent;
    recipientId: string;
    channel: 'email' | 'websocket';
    subject: string;
    body: string;
  }): Promise<void> {
    const deliveryBase: NotificationDelivery = {
      sourceEventId: input.event.eventId,
      sourceEventType: input.event.type,
      recipientId: input.recipientId,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      deliveredAt: null,
      createdAt: new Date()
    };

    try {
      await this.deliver(deliveryBase);
      return;
    } catch (error) {
      // At-least-once delivery; retry by republishing the same event.
      // RabbitMQ will route to the DLQ after TTL/attempt exhaustion.
      // We keep notification idempotency via Mongo unique indexes.
      this.logger.warn(
        `Scheduling notification retry (${input.channel}) for sourceEventId=${input.event.eventId}`,
        'NotificationConsumer'
      );

      await this.broker.retry(
        input.event,
        'notification.retry'
      );

      // Rethrow so the current message gets nacked and dead-lettered as configured.
      throw error;
    }
  }

  private async deliver(delivery: NotificationDelivery): Promise<void> {
    // Idempotent insert — skip if already processed
    const isNew = await this.repository.createDelivery(delivery);
    if (!isNew) {
      this.logger.log(
        `Duplicate notification skipped: ${delivery.sourceEventId} (${delivery.channel})`,
        'NotificationConsumer'
      );
      return;
    }

    try {
      if (delivery.channel === 'email') {
        await this.sendMockEmail(delivery);
      } else {
        this.sendWebSocket(delivery);
      }
      await this.repository.markDelivered(delivery.sourceEventId, delivery.channel);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.repository.markFailed(delivery.sourceEventId, delivery.channel, errorMsg);
      this.logger.warn(
        `Notification delivery failed (${delivery.channel}): ${errorMsg}`,
        'NotificationConsumer'
      );
      // Rethrow so RabbitMQ nacks the message → DLQ
      throw error;
    }
  }

  private async sendMockEmail(delivery: NotificationDelivery): Promise<void> {
    // In production, this would call SendGrid/SES/SMTP
    const from = process.env.NOTIFICATION_EMAIL_FROM ?? 'no-reply@atlas.local';
    const mode = process.env.NOTIFICATION_EMAIL_MODE ?? 'mock';

    if (mode === 'mock') {
      this.logger.log(
        `📧 [MOCK EMAIL] From: ${from} | To: ${delivery.recipientId} | Subject: ${delivery.subject}`,
        'NotificationConsumer'
      );
      this.logger.log(`   Body: ${delivery.body}`, 'NotificationConsumer');
      return;
    }

    // Real email implementation would go here
    throw new Error('Real email provider not configured');
  }

  private sendWebSocket(delivery: NotificationDelivery): void {
    const pushed = this.wsGateway.pushToUser(delivery.recipientId, {
      type: 'notification',
      eventType: delivery.sourceEventType,
      subject: delivery.subject,
      body: delivery.body,
      timestamp: new Date().toISOString()
    });

    if (!pushed) {
      this.logger.log(
        `WebSocket: user ${delivery.recipientId} not connected — notification logged only`,
        'NotificationConsumer'
      );
    }
  }

  private buildNotificationContent(event: DomainEvent): { subject: string; body: string } {
    const data = event.data as Record<string, unknown>;

    switch (event.type) {
      case 'leave.requested.v1':
        return {
          subject: 'New Leave Request',
          body: `Leave request submitted: ${data.leaveType} from ${data.startsOn} to ${data.endsOn} (${data.days} days)`
        };
      case 'leave.transitioned.v1':
        return {
          subject: `Leave Request Status: ${data.to}`,
          body: `Leave request moved from ${data.from} to ${data.to}`
        };
      case 'leave.approved.v1':
        return {
          subject: '✅ Leave Approved',
          body: `Your ${data.leaveType} leave (${data.days} days, ${data.startsOn} → ${data.endsOn}) has been approved`
        };
      case 'leave.rejected.v1':
        return {
          subject: '❌ Leave Rejected',
          body: `Your leave request has been rejected. Reason: ${data.reason ?? 'Not specified'}`
        };
      case 'payroll.run.processed.v1':
        return {
          subject: 'Pay Run Processed',
          body: `Pay run completed. Net pay: $${((data.netCents as number) / 100).toFixed(2)}`
        };
      case 'payslip.generated.v1':
        return {
          subject: 'Payslip Ready',
          body: `Your payslip is ready for download`
        };
      case 'employee.created.v1':
        return {
          subject: 'Welcome to Atlas EMS',
          body: `Welcome! Your employee profile has been created.`
        };
      default:
        return {
          subject: `Event: ${event.type}`,
          body: JSON.stringify(data)
        };
    }
  }
}
