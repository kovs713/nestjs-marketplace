import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxTransport, type OutboxMessage } from '@nestjs/outbox';
import { Kafka, logLevel, type Producer } from 'kafkajs';

import { EVENT_SCHEMA_VERSION } from '@app/contracts/events/envelope.js';

import { KAFKA_CONFIG_KEY, type KafkaConfig } from './kafka.config.js';
import { parseBrokers } from './kafka.util.js';

@Injectable()
export class KafkaOutboxTransport
  extends OutboxTransport
  implements OnApplicationShutdown
{
  private producer: Producer | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private brokers(): string[] {
    return parseBrokers(
      this.config.getOrThrow<KafkaConfig>(KAFKA_CONFIG_KEY).brokers,
    );
  }

  async onModuleInit(): Promise<void> {
    const brokers = this.brokers();
    this.producer = new Kafka({
      clientId: 'outbox-relay',
      brokers,
      logLevel: logLevel.NOTHING,
    }).producer({ idempotent: true });
    try {
      await this.producer.connect();
    } catch (error) {
      await this.onApplicationShutdown().catch(() => {});
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const producer = this.producer;
    this.producer = null;
    await producer?.disconnect();
  }

  async publish(
    message: OutboxMessage,
    { signal }: { signal: AbortSignal },
  ): Promise<void> {
    signal.throwIfAborted();
    if (!this.producer) {
      throw new Error('transport not connected');
    }

    await this.producer.send({
      topic: message.topic,
      messages: [
        {
          key: message.key ?? undefined,
          value: JSON.stringify(message.payload),
          headers: {
            event_id: message.id,
            event_type: message.headers.event_type ?? message.topic,
            schema_version:
              message.headers.schema_version ?? EVENT_SCHEMA_VERSION,
            correlation_id:
              message.headers.correlation_id ?? message.key ?? message.id,
          },
        },
      ],
    });

    signal.throwIfAborted();
  }
}
