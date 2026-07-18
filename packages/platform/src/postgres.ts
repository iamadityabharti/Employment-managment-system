import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { DomainEvent } from '@atlas/contracts';
import { StructuredLogger } from './logger';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;

  constructor(private readonly logger: StructuredLogger) {}

  async onModuleInit(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for a data-owning service');
    }
    this.pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 10) });
    await this.pool.query('SELECT 1');
    this.logger.log('PostgreSQL connection established', DatabaseService.name);
  }

  get client(): Pool {
    if (!this.pool) {
      throw new Error('Database has not been initialized');
    }
    return this.pool;
  }

  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number; oid: number; command: string; fields: unknown[] }> {
    return this.client.query<T>(text, values);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.client.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}

export async function createReliabilityTables(database: DatabaseService): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      event_id UUID PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS outbox_events_pending_idx ON outbox_events (created_at) WHERE published_at IS NULL;
    CREATE TABLE IF NOT EXISTS inbox_events (
      consumer_name TEXT NOT NULL,
      event_id UUID NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (consumer_name, event_id)
    );
    CREATE TABLE IF NOT EXISTS idempotency_records (
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER,
      response_body JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope, idempotency_key)
    );
  `);
}

@Injectable()
export class OutboxService {
  async enqueue(client: PoolClient, event: DomainEvent): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (event_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [event.eventId, event.type, JSON.stringify(event), event.occurredAt]
    );
  }
}

@Injectable()
export class InboxService {
  async accept(client: PoolClient, consumerName: string, eventId: string): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO inbox_events (consumer_name, event_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [consumerName, eventId]
    );
    return result.rowCount === 1;
  }
}

@Global()
@Module({
  providers: [DatabaseService, OutboxService, InboxService],
  exports: [DatabaseService, OutboxService, InboxService]
})
export class DatabaseModule {}
