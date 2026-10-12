import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { OutboxInbox } from '@nestjs/outbox';

import { PRODUCT_CREATED, productCreatedSchema, TOPICS } from '@app/contracts';
import { decodeEvent } from '@app/kafka';

import { StockRepository } from './stock.repository.js';
import { StockService } from './stock.service.js';

@Controller()
export class ProductCreatedConsumer {
  private readonly logger = new Logger(ProductCreatedConsumer.name);

  constructor(
    private readonly inbox: OutboxInbox,
    private readonly inventory: StockService,
    private readonly repository: StockRepository,
  ) {}

  @EventPattern<string>(TOPICS.product, Transport.KAFKA)
  async handle(
    @Payload() payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const event = decodeEvent(payload, context.getMessage().headers, {
      [PRODUCT_CREATED]: productCreatedSchema,
    });

    if (!event) return;

    const result = await this.repository.transaction(
      async (tx) =>
        await this.inbox.processInTransaction(
          tx,
          'inventory',
          event.eventId,
          () =>
            this.inventory.initializeStock(
              event.payload.product_id,
              event.payload.initial_stock,
              tx,
            ),
        ),
    );

    this.logger.debug({
      msg: result.duplicate
        ? 'product created event skipped as duplicate'
        : 'product created event applied',
      eventId: event.eventId,
      productId: event.payload.product_id,
    });
  }
}
