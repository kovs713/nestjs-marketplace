import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { Kafka, logLevel, type KafkaConfig as KafkaJsConfig } from 'kafkajs';
import { Pool } from 'pg';

import { parseBrokers } from '@app/kafka/kafka.util.js';

import { createPgPool } from '../utils/db-pool.util.js';

@Injectable()
export class DependencyHealthIndicator {
  private pools = new Map<string, Pool>();

  constructor(private readonly sessions: HealthIndicatorService) {}

  postgres(key: string, url: string): PromiseLike<HealthIndicatorResult> {
    let pool = this.pools.get(url);
    if (!pool) {
      pool = createPgPool(url, { max: 1 });
      this.pools.set(url, pool);
    }

    return this.sessions
      .check(key)
      .attempt(async () => {
        await pool.query('SELECT 1');
        return {};
      })
      .withTimeout(2000);
  }

  redis(key: string, url: string): PromiseLike<HealthIndicatorResult> {
    return this.sessions
      .check(key)
      .attempt(async () => {
        const client = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 1500,
        });
        try {
          await client.connect();
          return { pong: await client.ping() };
        } finally {
          client.disconnect();
        }
      })
      .withTimeout(2000);
  }

  kafka(
    key: string,
    brokersRaw: string,
    clientId: string,
  ): PromiseLike<HealthIndicatorResult> {
    return this.sessions
      .check(key)
      .attempt(async () => {
        const config: KafkaJsConfig = {
          clientId,
          brokers: parseBrokers(brokersRaw),
          logLevel: logLevel.NOTHING,
          retry: { retries: 0 },
        };

        const admin = new Kafka(config).admin();
        try {
          await admin.connect();
          const topics = (await admin.listTopics()).length;
          return { topics };
        } finally {
          await admin.disconnect();
        }
      })
      .withTimeout(5000);
  }
}
