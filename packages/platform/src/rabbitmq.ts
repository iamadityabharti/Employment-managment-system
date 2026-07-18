import {
  Global,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import amqplib, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { DomainEvent } from '@atlas/contracts';
import { DatabaseService } from './postgres';
import { StructuredLogger } from './logger';

const DOMAIN_EXCHANGE = 'ems.domain.v1';
const DEAD_LETTER_EXCHANGE = 'ems.dlx.v1';
const RETRY_EXCHANGE = 'ems.retry.v1';

export type EventHandler = (event: DomainEvent, raw: ConsumeMessage) => Promise<void>;

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private connecting?: Promise<void>;

  constructor(private readonly logger: StructuredLogger) {}

  onModuleInit(): void {
    void this.ensureConnected();
  }

  isConnected(): boolean {
    return Boolean(this.channel);
  }

  async ensureConnected(): Promise<void> {
    if (this.channel) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.ensureConnected();
    const channel = this.requireChannel();
    channel.publish(DOMAIN_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      timestamp: Math.floor(Date.now() / 1000),
      headers: {
        'x-trace-id': event.traceId,
        'x-causation-id': event.causationId ?? '',
        'x-event-type': event.type
      }
    });
    await channel.waitForConfirms();
  }

  async retry(event: DomainEvent, retryRoutingKey: string): Promise<void> {
    await this.ensureConnected();
    const channel = this.requireChannel();
    channel.publish(RETRY_EXCHANGE, retryRoutingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      headers: { 'x-retry': 'true', 'x-trace-id': event.traceId }
    });
    await channel.waitForConfirms();
  }

  async subscribe(queueName: string, patterns: string[], handler: EventHandler): Promise<void> {
    await this.ensureConnected();
    const channel = this.requireChannel();
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': `${queueName}.dead`
      }
    });
    await channel.assertQueue(`${queueName}.dlq`, { durable: true });
    await channel.bindQueue(`${queueName}.dlq`, DEAD_LETTER_EXCHANGE, `${queueName}.dead`);
    for (const pattern of patterns) {
      await channel.bindQueue(queueName, DOMAIN_EXCHANGE, pattern);
    }
    await channel.consume(queueName, async (message) => {
      if (!message) {
        return;
      }
      try {
        await handler(JSON.parse(message.content.toString()) as DomainEvent, message);
        channel.ack(message);
      } catch (error) {
        this.logger.error(error, undefined, `${queueName}: consumer failure`);
        channel.nack(message, false, false);
      }
    });
    this.logger.log(`Subscribed ${queueName} to ${patterns.join(', ')}`, RabbitMqService.name);
  }

  private async connect(): Promise<void> {
    const url = process.env.RABBITMQ_URL;
    if (!url) {
      this.logger.warn('RABBITMQ_URL is not set; outbox relay will retry when configured', RabbitMqService.name);
      return;
    }
    try {
      this.connection = await amqplib.connect(url);
      this.connection.on('close', () => {
        this.channel = undefined;
        this.connection = undefined;
      });
      this.connection.on('error', (error) => this.logger.error(error, undefined, RabbitMqService.name));
      this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange(DOMAIN_EXCHANGE, 'topic', { durable: true });
      await this.channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
      await this.channel.assertExchange(RETRY_EXCHANGE, 'topic', { durable: true });
      await this.channel.assertQueue('notification.retry.30s', {
        durable: true,
        arguments: {
          'x-message-ttl': 30000,
          'x-dead-letter-exchange': DOMAIN_EXCHANGE,
          'x-dead-letter-routing-key': 'notification.retry'
        }
      });
      await this.channel.bindQueue('notification.retry.30s', RETRY_EXCHANGE, 'notification.retry');
      this.logger.log('RabbitMQ connection established', RabbitMqService.name);
    } catch (error) {
      this.channel = undefined;
      this.connection = undefined;
      this.logger.warn(`RabbitMQ unavailable; events remain in the outbox: ${String(error)}`, RabbitMqService.name);
      throw error;
    }
  }

  private requireChannel(): ConfirmChannel {
    if (!this.channel) {
      throw new Error('RabbitMQ is not connected');
    }
    return this.channel;
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly broker: RabbitMqService,
    private readonly logger: StructuredLogger
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), Number(process.env.OUTBOX_POLL_MS ?? 1000));
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.broker.isConnected()) {
      return;
    }
    this.flushing = true;
    try {
      await this.database.transaction(async (client) => {
        const pending = await client.query<{
          event_id: string;
          payload: DomainEvent;
        }>(
          `SELECT event_id, payload FROM outbox_events
           WHERE published_at IS NULL
           ORDER BY created_at
           LIMIT 25
           FOR UPDATE SKIP LOCKED`
        );
        for (const row of pending.rows) {
          await this.broker.publish(row.payload);
          await client.query(
            'UPDATE outbox_events SET published_at = NOW(), attempts = attempts + 1 WHERE event_id = $1',
            [row.event_id]
          );
        }
      });
    } catch (error) {
      this.logger.warn(`Outbox relay will retry: ${String(error)}`, OutboxRelayService.name);
    } finally {
      this.flushing = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}

@Global()
@Module({
  providers: [RabbitMqService, OutboxRelayService],
  exports: [RabbitMqService, OutboxRelayService]
})
export class RabbitMqModule {}
