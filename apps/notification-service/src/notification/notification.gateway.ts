import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import { AppJwtService } from '@app/jwt';

const USER_ROOM = (userId: string) => `notification:user:${userId}`;

@Injectable()
@WebSocketGateway({ namespace: '/notifications' })
export class NotificationGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayConnection<Socket>,
    OnGatewayDisconnect<Socket>
{
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  private server!: Namespace;

  constructor(private readonly tokens: AppJwtService) {}

  afterInit(server: Namespace): void {
    server.use(async (client, next) => {
      const authorization = client.handshake.headers.authorization;
      let token: string;

      token =
        (typeof client.handshake.auth?.token === 'string' &&
          client.handshake.auth.token) ||
        (typeof authorization === 'string' &&
        authorization.startsWith('Bearer ')
          ? authorization.slice(7)
          : '');

      try {
        if (!token) throw new Error('missing bearer token');

        const claims = await this.tokens.verifyAccess(token);

        if (typeof claims.sub !== 'string' || !claims.sub) {
          throw new Error('invalid subject');
        }

        client.data.userId = claims.sub;
        next();
      } catch {
        this.logger.warn({
          msg: 'notification websocket authentication rejected',
          socketId: client.id,
        });
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const authorization = client.handshake.headers.authorization;

    const token =
      (typeof client.handshake.auth?.token === 'string' &&
        client.handshake.auth.token) ||
      (typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '');

    try {
      if (!token) {
        throw new Error('missing bearer token');
      }

      const claims = await this.tokens.verifyAccess(token);
      await client.join(USER_ROOM(claims.sub));
      client.data.userId = claims.sub;
      this.logger.debug({
        msg: 'notification websocket connected',
        socketId: client.id,
        userId: claims.sub,
      });
    } catch {
      this.logger.warn({
        msg: 'notification websocket connection rejected',
        socketId: client.id,
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug({
      msg: 'notification websocket disconnected',
      socketId: client.id,
    });
  }

  notify(userId: string, notification: { id: string }): void {
    this.server.to(USER_ROOM(userId)).emit('notification', {
      deliveryId: notification.id,
      notification,
    });
    this.logger.debug({
      msg: 'notification emitted to user room',
      userId,
      notificationId: notification.id,
    });
  }
}
