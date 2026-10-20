import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Socket } from 'node:net';

@Injectable()
export class TcpHealthIndicator {
  constructor(private readonly sessions: HealthIndicatorService) {}

  ping(
    key: string,
    host: string,
    port: number,
  ): PromiseLike<HealthIndicatorResult> {
    return this.sessions
      .check(key)
      .attempt(
        () =>
          new Promise<void>((resolve, reject) => {
            const socket = new Socket();
            socket.setTimeout(1000);
            socket.once('connect', () => {
              socket.destroy();
              resolve();
            });
            socket.once('timeout', () => {
              socket.destroy();
              reject(new Error('timeout'));
            });
            socket.once('error', reject);
            socket.connect(port, host);
          }),
      )
      .withTimeout(1500);
  }
}
