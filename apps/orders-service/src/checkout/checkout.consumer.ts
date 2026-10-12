import { Controller } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
  Transport,
} from '@nestjs/microservices';

import {
  CHECKOUT_REQUESTED,
  checkoutRequestedSchema,
  TOPICS,
} from '@app/contracts';
import { decodeEvent } from '@app/kafka';

import { CheckoutSaga } from './checkout.saga.js';

@Controller()
export class CheckoutConsumer {
  constructor(private readonly saga: CheckoutSaga) {}

  @EventPattern<string>(TOPICS.order, Transport.KAFKA)
  async handle(
    @Payload() payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const event = decodeEvent(payload, context.getMessage().headers, {
      [CHECKOUT_REQUESTED]: checkoutRequestedSchema,
    });
    if (!event) return;

    // Busy orders can be acknowledged: durable checkpoints remain recoverable.
    await this.saga.tryResume(event.payload.order_id);
  }
}
