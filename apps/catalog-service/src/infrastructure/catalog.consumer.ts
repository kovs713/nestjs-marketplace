import { Controller, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { OutboxInbox } from '@nestjs/outbox';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  STOCK_CHANGED,
  STOCK_INITIALIZED,
  stockChangedSchema,
  stockInitializedSchema,
  TOPICS,
} from '@app/contracts';
import { decodeEvent } from '@app/kafka';

import { CatalogQueries } from '../application/catalog.queries.js';
import { CatalogRepository } from './catalog.repository.js';

@Controller()
export class StockEventsConsumer {
  private readonly logger = new Logger(StockEventsConsumer.name);

  constructor(
    @InjectDrizzle()
    private readonly db: NodePgDatabase,
    private readonly repository: CatalogRepository,
    private readonly queries: CatalogQueries,
    private readonly inbox: OutboxInbox,
  ) {}

  @EventPattern<string>(TOPICS.stock, Transport.KAFKA)
  async handle(
    @Payload() payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const event = decodeEvent(payload, context.getMessage().headers, {
      [STOCK_INITIALIZED]: stockInitializedSchema,
      [STOCK_CHANGED]: stockChangedSchema,
    });
    if (!event) return;

    const result = await this.db.transaction(
      async (tx) =>
        await this.inbox.processInTransaction(
          tx,
          'catalog',
          event.eventId,
          () =>
            this.repository.upsertStockProjection(
              tx,
              event.payload.product_id,
              event.payload.in_stock,
              event.payload.in_reserved,
              event.payload.revision,
            ),
        ),
    );

    if (result.duplicate) {
      this.logger.debug({
        msg: 'stock event skipped as duplicate',
        eventId: event.eventId,
        eventType: event.eventType,
      });
      return;
    }

    await this.queries.invalidateProduct(event.payload.product_id);

    this.logger.debug({
      msg: 'stock projection updated',
      eventId: event.eventId,
      eventType: event.eventType,
      productId: event.payload.product_id,
      revision: event.payload.revision,
    });
  }
}
