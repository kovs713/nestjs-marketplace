import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  appConfig,
  AppLoggerModule,
  createPgPool,
  DATABASE_CONFIG_KEY,
  databaseConfig,
  type DatabaseConfig,
  HealthModule,
} from '@app/common';
import { AppJwtModule, tokenConfig } from '@app/jwt';

import { TokensService } from './tokens.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    AppLoggerModule.register('users-service'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/users-service/.env'],
      load: [appConfig, databaseConfig, tokenConfig],
    }),
    HealthModule,
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        db: drizzle({
          client: createPgPool(
            config.getOrThrow<DatabaseConfig>(DATABASE_CONFIG_KEY).url,
          ),
        }),
      }),
    }),
    AppJwtModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, TokensService],
})
export class UsersModule {}
