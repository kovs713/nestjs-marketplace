import { createMock } from '@golevelup/ts-vitest';
import { Controller, type INestMicroservice } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import {
  Kafka,
  type Consumer,
  type EachMessagePayload,
  type Producer,
} from 'kafkajs';

import { PRODUCT_CREATED, productCreatedSchema, TOPICS } from '@app/contracts';

import { decodeEvent } from './envelope.js';
import { kafkaConsumerOptions } from './kafka.config.js';

@Controller()
class TestEventsController {
  readonly process = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  @EventPattern<string>(TOPICS.product, Transport.KAFKA)
  async handle(
    @Payload() payload: unknown,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const event = decodeEvent(payload, context.getMessage().headers, {
      [PRODUCT_CREATED]: productCreatedSchema,
    });
    if (event) await this.process();
  }
}

describe('Nest Kafka transport', () => {
  let app: INestMicroservice;
  let controller: TestEventsController;
  let consumer: ReturnType<typeof createMock<Consumer>>;
  let deliver: (payload: EachMessagePayload) => Promise<void>;

  const message = (): EachMessagePayload =>
    createMock<EachMessagePayload>({
      topic: TOPICS.product,
      partition: 0,
      message: {
        offset: '42',
        timestamp: '0',
        attributes: 0,
        key: null,
        value: Buffer.from(
          JSON.stringify({
            product_id: 'product-1',
            seller_id: 'seller-1',
            initial_stock: 5,
          }),
        ),
        headers: {
          event_id: Buffer.from('event-1'),
          event_type: Buffer.from(PRODUCT_CREATED),
          schema_version: Buffer.from('1'),
        },
      },
    });

  beforeEach(async () => {
    consumer = createMock<Consumer>();
    vi.spyOn(Kafka.prototype, 'consumer').mockReturnValue(consumer);
    vi.spyOn(Kafka.prototype, 'producer').mockReturnValue(
      createMock<Producer>(),
    );
    consumer.run.mockImplementation(async (options) => {
      deliver = options!.eachMessage!;
    });
    const module = await Test.createTestingModule({
      controllers: [TestEventsController],
    }).compile();
    controller = module.get(TestEventsController);
    app = module.createNestMicroservice({
      ...kafkaConsumerOptions({ brokers: 'localhost:9092' }, 'inventory'),
      logger: false,
    });
    await app.listen();
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('preserves the group and subscribes decorated handlers with auto-commit', async () => {
    // then
    expect(Kafka.prototype.consumer).toHaveBeenCalledWith({
      groupId: 'inventory',
    });
    expect(consumer.subscribe).toHaveBeenCalledWith({
      topics: [TOPICS.product],
      fromBeginning: true,
    });
    expect(consumer.run).toHaveBeenCalledWith({
      autoCommit: true,
      eachMessage: expect.any(Function),
    });

    // when
    await deliver(message());

    // then
    expect(controller.process).toHaveBeenCalledOnce();
  });

  it('does not finish eachMessage until all handler work completes', async () => {
    // given
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    controller.process.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    let completed = false;
    const work = deliver(message()).then(() => {
      completed = true;
    });

    // when
    await entered;

    // then
    expect(completed).toBe(false);

    // when
    finish();
    await work;

    // then
    expect(completed).toBe(true);
  });

  it('rejects eachMessage on handler errors instead of acknowledging failure', async () => {
    // given
    controller.process.mockRejectedValue(new Error('post-commit failure'));

    // when & then
    await expect(deliver(message())).rejects.toBeDefined();
  });

  it('rejects eachMessage on envelope validation errors', async () => {
    // given
    const payload = message();
    payload.message.value = Buffer.from('{invalid');

    // when & then
    await expect(deliver(payload)).rejects.toBeDefined();
    expect(controller.process).not.toHaveBeenCalled();
  });
});
