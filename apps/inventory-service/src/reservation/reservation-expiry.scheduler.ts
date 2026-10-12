import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ReservationService } from './reservation.service.js';

@Injectable()
export class ReservationExpiryScheduler
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ReservationExpiryScheduler.name);

  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(private readonly inventory: ReservationService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    this.tick();
  }

  private tick(): void {
    if (this.stopping || this.running) return;

    this.running = this.inventory
      .expireReservations()
      .catch((error: unknown) =>
        this.logger.error({ err: error, msg: 'expired reservation GC failed' }),
      )
      .finally(() => {
        this.running = undefined;
      });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearInterval(this.timer);
    }

    await this.running;
  }
}
