import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { OrderRepository } from '../orders.repository.js';
import type { OrderStore } from '../ports.js';
import { CheckoutSaga } from './checkout.saga.js';

@Injectable()
export class RecoveryScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RecoveryScheduler.name);

  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private recovering = false;

  constructor(
    @Inject(OrderRepository)
    private readonly repository: OrderStore,
    private readonly saga: CheckoutSaga,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), 5_000);
    this.timer.unref();

    void this.run();
  }

  onModuleDestroy(): void {
    this.stopping = true;

    clearInterval(this.timer);
  }

  /** One pass, independently testable without starting timers or Nest. */
  async run(
    report: (error: unknown) => void = (error) =>
      this.logger.warn({ err: error, msg: 'saga recovery pass failed' }),
  ): Promise<void> {
    if (this.stopping || this.recovering) {
      return;
    }

    this.recovering = true;

    try {
      for (const id of await this.repository.recoverableIds()) {
        // Stop new attempts; persisted checkpoints survive shutdown.
        if (this.stopping) {
          break;
        }

        await this.repository.recoveryAttempted(id);
        if (!this.stopping) {
          await this.saga.tryResume(id).catch(report);
        }
      }
    } catch (error) {
      report(error);
    } finally {
      this.recovering = false;
    }
  }
}
