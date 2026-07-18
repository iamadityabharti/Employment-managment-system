import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@atlas/platform';
import { NotificationRepository } from './notification.repository';
import { WebSocketGatewayService } from './websocket.gateway';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly wsGateway: WebSocketGatewayService
  ) {}

  @Get()
  async list(
    @Query('recipientId') recipientId?: string,
    @Query('limit') limit?: string
  ) {
    return this.repository.listDeliveries({
      recipientId,
      limit: limit ? parseInt(limit, 10) : 50
    });
  }

  @Get('status')
  status() {
    return {
      connectedWebSocketUsers: this.wsGateway.getConnectedUserCount()
    };
  }
}
