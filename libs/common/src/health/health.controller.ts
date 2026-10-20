import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

import { S3_CONFIG_KEY } from '@app/files/s3/s3.config.js';
import { REDIS_CONFIG_KEY } from '@app/redis/redis.config.js';
import { DependencyHealthIndicator } from './deps.health.js';
import { TcpHealthIndicator } from './tcp.health.js';

type Check = () => PromiseLike<HealthIndicatorResult>;

@Controller('/health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly tcp: TcpHealthIndicator,
    private readonly deps: DependencyHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  @Get('/live')
  @HttpCode(HttpStatus.OK)
  live(): string {
    return 'OK';
  }

  @Get('/ready')
  ready() {
    const env = (key: string) => this.config.get<string>(key);
    const checks: Check[] = [];
    const maybe = (check: Check | null) => {
      if (check) checks.push(check);
    };

    // Real protocol probes: an open port does not mean a usable dependency.
    const kafka = env('KAFKA_BROKERS');
    if (kafka)
      maybe(() => this.deps.kafka('kafka', kafka, env('SERVICE') ?? 'app'));

    const redis = env('REDIS_URL');
    if (redis) maybe(() => this.deps.redis(REDIS_CONFIG_KEY, redis));

    const postgres = env('DATABASE_URL');
    if (postgres) maybe(() => this.deps.postgres('postgres', postgres));

    // No cheaper real check than a socket for these.
    const s3 = env('S3_HOST');
    if (s3)
      maybe(
        this.tcpCheck(S3_CONFIG_KEY, `${s3}:${env('S3_PORT') ?? '9000'}`, 9000),
      );

    for (const [key, value] of Object.entries(process.env))
      if (key.endsWith('_GRPC_URL'))
        maybe(this.tcpCheck(key.toLowerCase(), value, 50051));

    return this.health.check(checks);
  }

  private tcpCheck(
    key: string,
    value: string | undefined,
    fallbackPort: number,
  ): Check | null {
    const raw = value?.split(',')[0]?.trim();
    if (!raw) return null;

    let host: string;
    let port = fallbackPort;

    try {
      const url = new URL(raw.includes('://') ? raw : `tcp://${raw}`);
      host = url.hostname;
      if (url.port) port = Number(url.port);
    } catch {
      return null;
    }

    if (!host || !port) return null;
    return () => this.tcp.ping(key, host, port);
  }
}
