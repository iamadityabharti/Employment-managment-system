import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureHttpApplication } from '@atlas/platform';
import { NotificationModule } from './notification.module';
import { WebSocketGatewayService } from './websocket.gateway';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(NotificationModule, { bufferLogs: true });
  await configureHttpApplication(app, 'notification-service');

  const port = Number(process.env.PORT ?? 3005);
  const server = await app.listen(port, '0.0.0.0');

  // Attach WebSocket upgrade handler to the HTTP server
  const wsGateway = app.get(WebSocketGatewayService);
  wsGateway.attachToServer(server);
}

void bootstrap();
