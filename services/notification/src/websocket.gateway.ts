import { Injectable } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import type { IncomingMessage, Server } from 'node:http';
import type { JwtClaims } from '@atlas/contracts';
import { StructuredLogger } from '@atlas/platform';

/**
 * WebSocket gateway for real-time notification push.
 *
 * Clients connect with a JWT in the query string:
 *   ws://localhost:3005/ws?token=<access_token>
 *
 * On connection, the token is verified and the client is registered
 * in a Map keyed by user ID. Notifications are pushed as JSON messages.
 */
@Injectable()
export class WebSocketGatewayService {
  private wss?: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();

  constructor(private readonly logger: StructuredLogger) {}

  attachToServer(httpServer: Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
      if (request.url?.startsWith('/ws')) {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing authentication token');
        return;
      }

      try {
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
          ws.close(4002, 'Server misconfigured');
          return;
        }
        const claims = jwt.verify(token, secret) as JwtClaims;
        const userId = claims.sub;

        // Register the connection
        if (!this.clients.has(userId)) {
          this.clients.set(userId, new Set());
        }
        this.clients.get(userId)!.add(ws);

        this.logger.log(`WebSocket connected: user ${userId}`, 'WebSocketGateway');

        ws.on('close', () => {
          this.clients.get(userId)?.delete(ws);
          if (this.clients.get(userId)?.size === 0) {
            this.clients.delete(userId);
          }
          this.logger.log(`WebSocket disconnected: user ${userId}`, 'WebSocketGateway');
        });

        ws.on('error', (error) => {
          this.logger.error(error, undefined, 'WebSocketGateway');
        });

        // Send a welcome message
        ws.send(JSON.stringify({ type: 'connected', userId, timestamp: new Date().toISOString() }));
      } catch {
        ws.close(4003, 'Invalid or expired token');
      }
    });

    this.logger.log('WebSocket server attached', 'WebSocketGateway');
  }

  /**
   * Push a notification to a specific user's WebSocket connections.
   * Returns true if the message was sent to at least one connection.
   */
  pushToUser(userId: string, payload: unknown): boolean {
    const connections = this.clients.get(userId);
    if (!connections?.size) {
      return false;
    }

    const message = JSON.stringify(payload);
    let sent = false;
    for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        sent = true;
      }
    }
    return sent;
  }

  getConnectedUserCount(): number {
    return this.clients.size;
  }
}
