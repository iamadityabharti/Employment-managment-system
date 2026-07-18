import { Module } from '@nestjs/common';
import { CoreModule, RabbitMqModule } from '@atlas/platform';
import { NotificationConsumer } from './notification.consumer';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { WebSocketGatewayService } from './websocket.gateway';

/**
 * Notification Service module.
 *
 * Note: This service does NOT import DatabaseModule because it uses MongoDB
 * (polyglot persistence). The RabbitMqModule provides broker connectivity
 * without requiring a PostgreSQL outbox — this service is a pure consumer.
 */
@Module({
  imports: [CoreModule, RabbitMqModule],
  controllers: [NotificationController],
  providers: [
    NotificationRepository,
    NotificationConsumer,
    WebSocketGatewayService
  ]
})
export class NotificationModule {}
