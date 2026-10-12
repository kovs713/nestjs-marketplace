import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterFactory?: ReturnType<typeof createAdapter>;

  private pub?: Redis;
  private sub?: Redis;

  async connectToRedis(url: string): Promise<void> {
    const pub = new Redis(url, { lazyConnect: true });
    const sub = new Redis(url, { lazyConnect: true });

    try {
      await Promise.all([pub.connect(), sub.connect()]);

      this.pub = pub;
      this.sub = sub;
      this.adapterFactory = createAdapter(pub, sub);

      this.logger.log({
        msg: 'notification websocket Redis adapter connected',
      });
    } catch (error) {
      pub.disconnect();
      sub.disconnect();

      this.logger.error({
        err: error,
        msg: 'notification websocket Redis adapter connection failed',
      });

      throw error;
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterFactory) {
      throw new Error('Redis adapter not initialized');
    }

    const server = super.createIOServer(port, options) as Server;

    server.adapter(this.adapterFactory);

    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);

    this.pub?.disconnect();
    this.sub?.disconnect();

    this.logger.log({ msg: 'notification websocket Redis adapter closed' });
  }
}
