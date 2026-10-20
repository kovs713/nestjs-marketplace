import { DynamicModule, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS_CONFIG_KEY, type RedisConfig } from './redis.config.js';
import { REDIS_CLIENT } from './redis.constants.js';

@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleDestroy() {
    this.redis.disconnect();
  }

  static forRootAsync(): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_CLIENT,
          inject: [ConfigService],
          useFactory: (config: ConfigService): Redis =>
            new Redis(config.getOrThrow<RedisConfig>(REDIS_CONFIG_KEY).url, {
              lazyConnect: true,
            }),
        },
      ],
      exports: [REDIS_CLIENT],
    };
  }
}
