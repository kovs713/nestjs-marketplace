import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { RequestIdInterceptor } from './request-id.interceptor.js';

@Module({})
export class AppLoggerModule {
  static register(service: string): DynamicModule {
    return {
      module: AppLoggerModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            name: service,
            level: process.env.LOG_LEVEL ?? 'info',

            transport:
              process.env.NODE_ENV === 'production'
                ? undefined
                : { target: 'pino-pretty', options: { singleLine: true } },

            genReqId: (req) => {
              const header = req.headers['x-request-id'];
              const id = Array.isArray(header) ? header[0] : header;

              return typeof id === 'string' && id.trim().length > 0
                ? id
                : randomUUID();
            },

            autoLogging: {
              ignore: (req) => req.url?.startsWith('/health') ?? false,
            },
          },
        }),
      ],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: RequestIdInterceptor,
        },
      ],
    };
  }
}
