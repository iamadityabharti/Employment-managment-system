import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MongoClient, type Collection, type Db } from 'mongodb';
import { StructuredLogger } from '@atlas/platform';

export interface NotificationDelivery {
  sourceEventId: string;
  sourceEventType: string;
  recipientId: string;
  channel: 'email' | 'websocket';
  subject: string;
  body: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationRepository implements OnModuleInit, OnModuleDestroy {
  private client?: MongoClient;
  private db?: Db;

  constructor(private readonly logger: StructuredLogger) {}

  async onModuleInit(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is required for the notification service');
    }
    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db();

    // Create unique index for idempotent delivery
    await this.deliveries().createIndex(
      { sourceEventId: 1, channel: 1 },
      { unique: true }
    );

    this.logger.log('MongoDB connection established', 'NotificationRepository');
  }

  private deliveries(): Collection<NotificationDelivery> {
    if (!this.db) {
      throw new Error('MongoDB not initialized');
    }
    return this.db.collection<NotificationDelivery>('notificationDeliveries');
  }

  /**
   * Idempotent insert: if (sourceEventId, channel) already exists, skip.
   * Returns true if the delivery was newly created, false if it was a duplicate.
   */
  async createDelivery(delivery: NotificationDelivery): Promise<boolean> {
    try {
      await this.deliveries().insertOne(delivery);
      return true;
    } catch (error: unknown) {
      // MongoDB duplicate key error code is 11000
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 11000) {
        return false; // Already processed this event for this channel
      }
      throw error;
    }
  }

  async markDelivered(sourceEventId: string, channel: 'email' | 'websocket'): Promise<void> {
    await this.deliveries().updateOne(
      { sourceEventId, channel },
      { $set: { status: 'delivered', deliveredAt: new Date() } }
    );
  }

  async markFailed(sourceEventId: string, channel: 'email' | 'websocket', error: string): Promise<void> {
    await this.deliveries().updateOne(
      { sourceEventId, channel },
      {
        $set: { status: 'failed', lastError: error, lastAttemptAt: new Date() },
        $inc: { attempts: 1 }
      }
    );
  }

  async listDeliveries(filters?: { recipientId?: string; limit?: number }): Promise<NotificationDelivery[]> {
    const query: Record<string, unknown> = {};
    if (filters?.recipientId) {
      query.recipientId = filters.recipientId;
    }
    return this.deliveries()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filters?.limit ?? 50)
      .toArray();
  }

  async findByEventId(sourceEventId: string): Promise<NotificationDelivery[]> {
    return this.deliveries().find({ sourceEventId }).toArray();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }
}
