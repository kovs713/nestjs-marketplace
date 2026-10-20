import { registerAs } from '@nestjs/config';
import { Transport, type KafkaOptions } from '@nestjs/microservices';
import { z } from 'zod';

import { validateConfig } from '@app/common/config/validate-config.js';

import { parseBrokers } from './kafka.util.js';

export type KafkaConfig = {
  brokers: string;
};

export const kafkaEnvSchema = z.object({
  KAFKA_BROKERS: z
    .string()
    .min(1, 'KAFKA_BROKERS is required')
    .regex(/^[\w.-]+:\d+(,[\w.-]+:\d+)*$/, {
      message: 'KAFKA_BROKERS must be host:port[,host:port…]',
    }),
});

export const KAFKA_CONFIG_KEY = 'kafka';

export const kafkaConsumerOptions = (
  config: KafkaConfig,
  groupId: string,
): KafkaOptions => ({
  transport: Transport.KAFKA,
  options: {
    client: { clientId: groupId, brokers: parseBrokers(config.brokers) },
    consumer: { groupId },
    postfixId: '',
    subscribe: { fromBeginning: true },
    run: { autoCommit: true },
  },
});

export default registerAs<KafkaConfig>(KAFKA_CONFIG_KEY, () => {
  const env = validateConfig(process.env, kafkaEnvSchema);
  return { brokers: env.KAFKA_BROKERS };
});
