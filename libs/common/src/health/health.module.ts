import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { DependencyHealthIndicator } from './deps.health.js';
import { HealthController } from './health.controller.js';
import { TcpHealthIndicator } from './tcp.health.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [TcpHealthIndicator, DependencyHealthIndicator],
})
export class HealthModule {}
