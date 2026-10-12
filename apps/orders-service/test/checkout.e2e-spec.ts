import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { createMock } from '@golevelup/ts-vitest';
import type { KafkaContext } from '@nestjs/microservices';
import { Outbox, OutboxRelay, OutboxStorage } from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DomainError } from '@app/common';
import { CHECKOUT_REQUESTED, TOPICS } from '@app/contracts';

import { CheckoutSaga } from '../src/checkout/checkout.saga.js';
import { CheckoutConsumer } from '../src/checkout/checkout.consumer.js';
import { OrdersService } from '../src/orders.service.js';
import type { Catalog, Inventory, Payment, Payments } from '../src/ports.js';
import { OrderRepository } from '../src/orders.repository.js';
import { RecoveryScheduler } from '../src/checkout/recovery.scheduler.js';

// Run: bunx vitest run --config vitest.config.e2e.ts apps/orders-service/test
// Starts PostgreSQL 18 via Testcontainers unless ORDERS_TEST_DATABASE_URL is set.
// Isolated schemas, recreated pools/services, simulated external systems.
const url = process.env.ORDERS_TEST_DATABASE_URL;
const schema = `orders_test_${randomUUID().replaceAll('-', '')}`;
const actor = { id: randomUUID() };
const product = {
  id: randomUUID(),
  sellerId: randomUUID(),
  title: 'Product',
  priceMinor: 125,
};

describe('checkout recovery (PostgreSQL)', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: OrderRepository;
  let process: CheckoutSaga;
  let recovery: RecoveryScheduler;
  let service: OrdersService;
  let messages: PostgresOutboxStore;
  const pools: Pool[] = [];
  let inventory: Inventory;
  let catalog: Catalog;
  let payments: Payments;
  let payment: Payment;
  let charges: Set<string>;
  let refunds: Set<string>;
  let reservations: Set<string>;
  let releases: Set<string>;

  async function connect() {
    pool = new Pool({
      connectionString: url,
      max: 20,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schema},public`,
    });
    pools.push(pool);
    const db = drizzle({ client: pool });
    const storage = new OutboxStorage();
    messages = new PostgresOutboxStore(
      { executor: fromDrizzle(db), schema: `${schema}_outbox` },
      storage,
    );
    await messages.onModuleInit();
    const outbox = new Outbox(
      storage,
      new OutboxRelay({
        store: messages,
        transports: {},
        relay: { enabled: false },
      }),
    );
    repository = new OrderRepository(db, outbox);
    process = new CheckoutSaga(repository, inventory, payments);
    recovery = new RecoveryScheduler(repository, process);
    catalog = { getProduct: async () => product };
    service = new OrdersService(repository, catalog, process);
  }

  async function restart() {
    await pool.end();
    pools.splice(pools.indexOf(pool), 1);
    await connect();
  }

  async function checkout() {
    await service.addToCart(actor, { productId: product.id, quantity: 2 });
    return service.checkout(actor, { idempotencyKey: randomUUID() });
  }

  async function state(id: string) {
    return (await repository.load(id)).state;
  }

  beforeAll(async () => {
    if (!url)
      throw new Error(
        'Set ORDERS_TEST_DATABASE_URL to a disposable PostgreSQL 18 database',
      );
    admin = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const client = await admin.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      await client.query(
        await readFile(
          new URL(
            '../drizzle/20261015112454_initial/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    payment = { status: 'PENDING' };
    charges = new Set();
    refunds = new Set();
    reservations = new Set();
    releases = new Set();
    inventory = {
      reserve: vi.fn(async (_order, key) => {
        reservations.add(key);
      }),
      commit: vi.fn(async () => undefined),
      release: vi.fn(async (_id, key) => {
        releases.add(key);
      }),
    };
    payments = {
      create: vi.fn(async () => undefined),
      capture: vi.fn(async (_id, key) => {
        charges.add(key);
        payment = { status: 'SUCCEEDED' };
        return payment;
      }),
      getByOrder: vi.fn(async () => payment),
      refund: vi.fn(async (_id, key) => {
        refunds.add(key);
        payment = { status: 'REFUNDED' };
        return payment;
      }),
    };
    await connect();
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end()));
    if (admin) {
      await admin.query(
        `TRUNCATE ${schema}.orders, ${schema}.order_items, ${schema}.checkout_idempotency`,
      );
      await admin.query(`TRUNCATE ${schema}_outbox.messages`);
    }
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS ${schema}_outbox CASCADE`);
      await admin.end();
    }
  });

  it('starts Saga from the durable checkout event; redelivery after restart does not charge twice', async () => {
    const reserve = vi.spyOn(inventory, 'reserve');
    const capture = vi.spyOn(payments, 'capture');
    const accepted = await checkout();
    expect(reserve).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    const events = await messages.claim({
      owner: 'test',
      now: Date.now(),
      leaseMs: 30_000,
      limit: 10,
    });
    const event = events.find((message) => message.topic === TOPICS.order)!;
    expect(event).toMatchObject({
      key: accepted.id,
      headers: { event_type: CHECKOUT_REQUESTED },
      payload: { order_id: accepted.id },
    });
    const context = createMock<KafkaContext>();
    context.getMessage.mockReturnValue(
      createMock<ReturnType<KafkaContext['getMessage']>>({
        headers: { ...event.headers, event_id: event.id },
      }),
    );
    await new CheckoutConsumer(process).handle(event.payload, context);
    expect((await state(accepted.id)).status).toBe('CONFIRMED');
    await restart();
    await new CheckoutConsumer(process).handle(event.payload, context);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(charges.size).toBe(1);
  });

  it('rolls back checkout, prices and idempotency when its start event cannot be persisted', async () => {
    const cart = await service.addToCart(actor, {
      productId: product.id,
      quantity: 2,
    });
    const key = randomUUID();
    await admin.query(
      `ALTER TABLE ${schema}_outbox.messages ADD CONSTRAINT fail_checkout CHECK (topic <> 'order.events') NOT VALID`,
    );
    try {
      await expect(
        service.checkout(actor, { idempotencyKey: key }),
      ).rejects.toThrow();
      expect(await service.getCart(actor)).toEqual(cart);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
      expect(
        (await admin.query(`SELECT * FROM ${schema}.checkout_idempotency`))
          .rows,
      ).toEqual([]);
    } finally {
      await admin.query(
        `ALTER TABLE ${schema}_outbox.messages DROP CONSTRAINT fail_checkout`,
      );
    }
    expect(
      await service.checkout(actor, { idempotencyKey: key }),
    ).toMatchObject({
      id: cart.id,
      status: 'PENDING_PAYMENT',
      totalMinor: 250,
    });
  });

  it('executes reserve → create → durable intent → capture → PAID → commit → CONFIRMED', async () => {
    const accepted = await checkout();
    const steps: string[] = [];
    const load = repository.load.bind(repository);
    const save = repository.save.bind(repository);
    const recordIntent = repository.recordCaptureIntent.bind(repository);
    vi.spyOn(repository, 'load').mockImplementation(async (id) => {
      const order = await load(id);
      steps.push(`load:${order.state.captureIntentRecorded}`);
      return order;
    });
    vi.spyOn(repository, 'save').mockImplementation(async (order, expected) => {
      await save(order, expected);
      steps.push(`saved:${order.status}`);
    });
    vi.spyOn(repository, 'recordCaptureIntent').mockImplementation(
      async (id) => {
        await recordIntent(id);
        steps.push('intent persisted');
      },
    );
    vi.spyOn(inventory, 'reserve').mockImplementation(async () => {
      steps.push('reserve');
    });
    vi.spyOn(payments, 'create').mockImplementation(async () => {
      steps.push('create');
    });
    vi.spyOn(payments, 'capture').mockImplementation(async () => {
      const checkpoint = await admin.query(
        `SELECT capture_intent_recorded FROM ${schema}.orders WHERE id = $1`,
        [accepted.id],
      );
      expect(checkpoint.rows[0].capture_intent_recorded).toBe(true);
      steps.push('capture');
      return { status: 'SUCCEEDED' };
    });
    vi.spyOn(inventory, 'commit').mockImplementation(async () => {
      steps.push('commit');
    });

    expect((await process.resume(accepted.id)).status).toBe('CONFIRMED');
    expect(steps).toEqual([
      'load:false',
      'reserve',
      'create',
      'intent persisted',
      'capture',
      'load:true',
      'saved:PAID',
      'commit',
      'saved:CONFIRMED',
    ]);
  });

  it.each(['FAILED_PRECONDITION', 'UNAVAILABLE'] as const)(
    'returns terminal Reserve business failure but preserves infrastructure error %s',
    async (code) => {
      const accepted = await checkout();
      const error = new DomainError(code, 'reserve rejected');
      const create = vi.spyOn(payments, 'create');
      const capture = vi.spyOn(payments, 'capture');
      const intent = vi.spyOn(repository, 'recordCaptureIntent');
      const release = vi.spyOn(inventory, 'release');
      vi.spyOn(inventory, 'reserve').mockRejectedValueOnce(error);

      if (code === 'FAILED_PRECONDITION') {
        await expect(process.resume(accepted.id)).resolves.toMatchObject({
          status: 'FAILED',
          failureReason: 'reserve rejected',
        });
      } else {
        await expect(process.resume(accepted.id)).rejects.toBe(error);
      }
      expect(await state(accepted.id)).toMatchObject({
        status: code === 'FAILED_PRECONDITION' ? 'FAILED' : 'PENDING_PAYMENT',
        captureIntentRecorded: false,
        compensationPending: false,
      });
      expect(release).toHaveBeenCalledTimes(
        code === 'FAILED_PRECONDITION' ? 1 : 0,
      );
      expect(create).not.toHaveBeenCalled();
      expect(intent).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('keeps an unresolved capture recoverable and reconciles its current status after restart', async () => {
    const order = await checkout();
    const reserve = vi.spyOn(inventory, 'reserve');
    // The replay remains PENDING even when the provider later settles the charge.
    payments.capture = vi.fn<Payments['capture']>(async (_id, key) => {
      charges.add(key);
      return { status: 'PENDING' };
    });
    const pending = await process.resume(order.id);
    expect(pending).toMatchObject({
      status: 'PENDING_PAYMENT',
    });
    expect(await state(order.id)).toMatchObject({
      captureIntentRecorded: true,
      compensationPending: false,
    });
    expect(reserve).toHaveBeenCalledWith(
      order,
      `${order.id}:reserve`,
      (await state(order.id)).paymentTimeoutAt,
    );
    expect(releases.size).toBe(0);
    expect(refunds.size).toBe(0);
    await restart();
    payment = { status: 'SUCCEEDED' };
    const errors: unknown[] = [];
    await recovery.run((error) => errors.push(error));
    expect(errors).toEqual([]);
    expect(await service.get(actor, order.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(charges.size).toBe(1);
  });

  it('keeps saga metadata out of cart, checkout, replay, query and process responses', async () => {
    const empty = await service.getCart(actor);
    const cart = await service.addToCart(actor, {
      productId: product.id,
      quantity: 2,
    });
    const key = randomUUID();
    const accepted = await service.checkout(actor, { idempotencyKey: key });
    const confirmed = await process.resume(accepted.id);
    const replay = await service.checkout(actor, { idempotencyKey: key });
    const current = await service.get(actor, accepted.id);
    const page = await service.list(actor, { statuses: ['CONFIRMED'] });
    const next = await checkout();
    const canceled = await process.cancel(actor.id, next.id);
    for (const view of [
      empty,
      cart,
      accepted,
      confirmed,
      replay,
      current,
      ...page.items,
      canceled,
    ]) {
      expect(view).not.toHaveProperty('captureIntentRecorded');
      expect(view).not.toHaveProperty('compensationPending');
      expect(view).not.toHaveProperty('paymentTimeoutAt');
    }
    expect(replay).toEqual(accepted);
    expect((await state(accepted.id)).captureIntentRecorded).toBe(true);
    const stored = await admin.query(
      `SELECT response FROM ${schema}.checkout_idempotency WHERE key = $1`,
      [key],
    );
    expect(stored.rows[0].response).toEqual({
      ...accepted,
      createdAt: accepted.createdAt.getTime(),
      updatedAt: accepted.updatedAt.getTime(),
      items: accepted.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.getTime(),
      })),
    });
  });

  it('changes cart quantity and removes items through distinct actions', async () => {
    const cart = await service.addToCart(actor, {
      productId: product.id,
      quantity: 2,
    });
    const orderItemId = cart.items[0]!.id;
    const updated = await service.updateCartItem(actor, {
      orderItemId,
      quantity: 5,
    });
    expect(updated.items[0]).toMatchObject({ id: orderItemId, quantity: 5 });
    await expect(
      service.updateCartItem(actor, { orderItemId, quantity: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await service.getCart(actor)).items[0]!.quantity).toBe(5);
    expect(
      (await service.removeCartItem(actor, { orderItemId })).items,
    ).toEqual([]);
    await expect(
      service.removeCartItem(actor, { orderItemId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('publishes a notification per notifiable status and rejects repeated or stale saves', async () => {
    const accepted = await checkout();
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    const order = await repository.load(accepted.id);
    order.paid();
    await repository.save(order, 'PENDING_PAYMENT');
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 3 });
    order.confirm();
    await repository.save(order, 'PAID');
    await expect(repository.save(order, 'PAID')).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    await expect(repository.save(order, 'CONFIRMED')).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    const notifications = await messages.claim({
      owner: 'test',
      now: Date.now(),
      leaseMs: 30_000,
      limit: 10,
    });
    expect(
      notifications
        .filter((message) => message.topic === TOPICS.notification)
        .map((message) => message.payload),
    ).toMatchObject([
      {
        user_id: actor.id,
        order_id: accepted.id,
        title: 'Order placed',
        payload: { status: 'PENDING_PAYMENT' },
      },
      { title: 'Payment received', payload: { status: 'PAID' } },
      { title: 'Order confirmed', payload: { status: 'CONFIRMED' } },
    ]);
  });

  it('resumes after reservation without allocating inventory twice', async () => {
    const accepted = await checkout();
    vi.spyOn(payments, 'create').mockRejectedValueOnce(
      new DomainError('UNAVAILABLE', 'interrupted after reservation'),
    );
    await expect(process.resume(accepted.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(reservations.size).toBe(1);
    expect(await state(accepted.id)).toMatchObject({
      status: 'PENDING_PAYMENT',
      captureIntentRecorded: false,
    });
    await restart();
    const errors: unknown[] = [];
    await recovery.run((error) => errors.push(error));
    expect(errors).toEqual([]);
    expect(await service.get(actor, accepted.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(reservations.size).toBe(1);
    expect(charges.size).toBe(1);
  });

  it.each(['before capture request', 'after successful charge'])(
    'recovers interruption %s without a second charge',
    async (boundary) => {
      const accepted = await checkout();
      const reserve = vi.spyOn(inventory, 'reserve');
      const create = vi.spyOn(payments, 'create');
      const capture = payments.capture.bind(payments);
      vi.spyOn(payments, 'capture').mockImplementationOnce(async (id, key) => {
        if (boundary === 'after successful charge') await capture(id, key);
        throw new DomainError('UNAVAILABLE', boundary);
      });
      await expect(process.resume(accepted.id)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
      expect(await state(accepted.id)).toMatchObject({
        status: 'PENDING_PAYMENT',
        captureIntentRecorded: true,
      });
      await restart();
      const reconcile = vi.spyOn(payments, 'getByOrder');
      const errors: unknown[] = [];
      await recovery.run((error) => errors.push(error));
      expect(errors).toEqual([]);
      expect(await service.get(actor, accepted.id)).toMatchObject({
        status: 'CONFIRMED',
      });
      expect([...charges]).toEqual([`${accepted.id}:capture`]);
      expect([...reservations]).toEqual([`${accepted.id}:reserve`]);
      expect(reconcile).toHaveBeenCalledWith(accepted.id);
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it('resumes a persisted PAID order after inventory commit is interrupted', async () => {
    const accepted = await checkout();
    vi.spyOn(inventory, 'commit').mockRejectedValueOnce(
      new DomainError('UNAVAILABLE', 'commit interrupted'),
    );
    await expect(process.resume(accepted.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(await service.get(actor, accepted.id)).toMatchObject({
      status: 'PAID',
    });
    await restart();
    const errors: unknown[] = [];
    await recovery.run((error) => errors.push(error));
    expect(errors).toEqual([]);
    expect(await service.get(actor, accepted.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(charges.size).toBe(1);
    expect(refunds.size).toBe(0);
  });

  it.each(['release', 'refund'] as const)(
    'finishes compensation after a lost %s response and restart',
    async (operation) => {
      const accepted = await checkout();
      const capture = payments.capture.bind(payments);
      vi.spyOn(payments, 'capture').mockImplementationOnce(async (id, key) => {
        await capture(id, key);
        throw new DomainError('UNAVAILABLE', 'capture response lost');
      });
      await expect(process.resume(accepted.id)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
      if (operation === 'release') {
        const release = inventory.release.bind(inventory);
        vi.spyOn(inventory, 'release').mockImplementationOnce(
          async (id, key) => {
            await release(id, key);
            throw new DomainError('UNAVAILABLE', 'release response lost');
          },
        );
      } else {
        const refund = payments.refund.bind(payments);
        vi.spyOn(payments, 'refund').mockImplementationOnce(async (id, key) => {
          await refund(id, key);
          throw new DomainError('UNAVAILABLE', 'refund response lost');
        });
      }
      await expect(process.cancel(actor.id, accepted.id)).rejects.toMatchObject(
        { code: 'UNAVAILABLE' },
      );
      expect(await state(accepted.id)).toMatchObject({
        status: 'CANCELED',
        compensationPending: true,
      });
      await restart();
      const errors: unknown[] = [];
      await recovery.run((error) => errors.push(error));
      expect(errors).toEqual([]);
      expect(await state(accepted.id)).toMatchObject({
        status: 'CANCELED',
        compensationPending: false,
      });
      expect([...charges]).toEqual([`${accepted.id}:capture`]);
      expect([...refunds]).toEqual([`${accepted.id}:refund`]);
      expect([...releases]).toEqual([`${accepted.id}:reserve`]);
      expect(await repository.recoverableIds()).not.toContain(accepted.id);
      expect(
        (
          await messages.claim({
            owner: 'test',
            now: Date.now(),
            leaseMs: 30_000,
            limit: 10,
          })
        )
          .filter((event) => event.topic === TOPICS.notification)
          .map((event) => event.payload),
      ).toMatchObject([
        { payload: { status: 'PENDING_PAYMENT' } },
        { payload: { status: 'CANCELED' } },
      ]);
    },
  );

  it('settles the stable capture intent then refunds when canceled before capture was sent', async () => {
    const accepted = await checkout();
    vi.spyOn(payments, 'capture').mockRejectedValueOnce(
      new DomainError('UNAVAILABLE', 'request never sent'),
    );
    await expect(process.resume(accepted.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(charges.size).toBe(0);
    await restart();
    expect(await process.cancel(actor.id, accepted.id)).toMatchObject({
      status: 'CANCELED',
    });
    expect(await state(accepted.id)).toMatchObject({
      compensationPending: false,
    });
    expect([...charges]).toEqual([`${accepted.id}:capture`]);
    expect([...refunds]).toEqual([`${accepted.id}:refund`]);
    expect([...releases]).toEqual([`${accepted.id}:reserve`]);
  });

  it('rejects overlapping resume/cancel for one order without holding a DB connection during RPC', async () => {
    const accepted = await checkout();
    const first = process;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserve = inventory.reserve.bind(inventory);
    const reserveSpy = vi
      .spyOn(inventory, 'reserve')
      .mockImplementationOnce(async (order, key, expiresAt) => {
        entered();
        await gate;
        await reserve(order, key, expiresAt);
      });
    const running = first.resume(accepted.id);
    try {
      await started;
      expect(pool.idleCount).toBe(pool.totalCount);

      await expect(first.resume(accepted.id)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        message: 'order is already being processed',
      });
      await expect(
        first.resume(accepted.id.toUpperCase()),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' });

      await expect(first.cancel(actor.id, accepted.id)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });

      expect(charges.size).toBe(0);
      expect(reserveSpy).toHaveBeenCalledOnce();

      const other = await checkout();

      const errors: unknown[] = [];
      expect(await first.tryResume(accepted.id.toUpperCase())).toBeUndefined();
      await recovery.run((error) => errors.push(error));
      expect(errors).toEqual([]);
      expect(reserveSpy).toHaveBeenCalledTimes(2);
      expect(await service.get(actor, other.id)).toMatchObject({
        status: 'CONFIRMED',
      });
    } finally {
      release();
      await running;
    }
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(charges.size).toBe(2);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 8 });
  });

  it('allows retry in the same process after a saga failure', async () => {
    const accepted = await checkout();

    vi.spyOn(inventory, 'reserve').mockRejectedValueOnce(
      new DomainError('UNAVAILABLE', 'inventory unavailable'),
    );

    await expect(process.resume(accepted.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });

    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(charges.size).toBe(1);
  });

  it('acknowledges a checkout event while Recovery owns the Saga', async () => {
    const accepted = await checkout();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserve = vi
      .spyOn(inventory, 'reserve')
      .mockImplementationOnce(async () => {
        enter();
        await gate;
      });
    const context = createMock<KafkaContext>();
    context.getMessage.mockReturnValue(
      createMock<ReturnType<KafkaContext['getMessage']>>({
        headers: {
          event_id: randomUUID(),
          event_type: CHECKOUT_REQUESTED,
          schema_version: '1',
        },
      }),
    );
    const running = recovery.run();
    try {
      await entered;
      await expect(
        new CheckoutConsumer(process).handle(
          { order_id: accepted.id },
          context,
        ),
      ).resolves.toBeUndefined();
      expect(reserve).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await running;
    }
    expect((await state(accepted.id)).status).toBe('CONFIRMED');
    expect(charges.size).toBe(1);
  });

  it.each(['release', 'refund'] as const)(
    'keeps Saga active after %s fails until the other compensation settles',
    async (failed) => {
      const accepted = await checkout();
      await repository.recordCaptureIntent(accepted.id);
      payment = { status: 'SUCCEEDED' };
      const error = new DomainError('UNAVAILABLE', `${failed} unavailable`);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (failed === 'release') {
        vi.spyOn(inventory, 'release').mockRejectedValueOnce(error);
        const refund = payments.refund.bind(payments);
        vi.spyOn(payments, 'refund').mockImplementationOnce(async (id, key) => {
          enter();
          await gate;
          return refund(id, key);
        });
      } else {
        vi.spyOn(payments, 'refund').mockRejectedValueOnce(error);
        const releaseInventory = inventory.release.bind(inventory);
        vi.spyOn(inventory, 'release').mockImplementationOnce(
          async (id, key) => {
            enter();
            await gate;
            await releaseInventory(id, key);
          },
        );
      }
      let settled = false;
      const outcome = process.cancel(actor.id, accepted.id).then(
        (result) => {
          settled = true;
          return result;
        },
        (failure: unknown) => {
          settled = true;
          return failure;
        },
      );
      try {
        await entered;
        await setImmediate();
        expect(settled).toBe(false);
        expect(await process.tryResume(accepted.id)).toBeUndefined();
      } finally {
        release();
        await outcome;
      }
      expect(await outcome).toBe(error);
      expect((await state(accepted.id)).compensationPending).toBe(true);
      await restart();
      await recovery.run();
      expect(await state(accepted.id)).toMatchObject({
        status: 'CANCELED',
        compensationPending: false,
      });
      expect(refunds.size).toBe(1);
    },
  );

  it('rolls back the status transition when its notification cannot be persisted', async () => {
    const accepted = await checkout();
    const order = await repository.load(accepted.id);
    order.cancel();
    await admin.query(
      `ALTER TABLE ${schema}_outbox.messages ADD CONSTRAINT fail_notification CHECK (false) NOT VALID`,
    );
    try {
      await expect(repository.save(order, 'PENDING_PAYMENT')).rejects.toThrow();
      expect(await state(accepted.id)).toMatchObject({
        status: 'PENDING_PAYMENT',
        compensationPending: false,
      });
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    } finally {
      await admin.query(
        `ALTER TABLE ${schema}_outbox.messages DROP CONSTRAINT fail_notification`,
      );
    }
    await repository.save(order, 'PENDING_PAYMENT');
    expect(await state(accepted.id)).toMatchObject({
      status: 'CANCELED',
      compensationPending: true,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 3 });
  });

  it('lists paginated orders with their own items, filtering owner and status', async () => {
    const accepted = [await checkout(), await checkout(), await checkout()];
    await service.addToCart(actor, { productId: product.id, quantity: 7 });
    const stranger = { id: randomUUID() };
    await service.addToCart(stranger, { productId: product.id, quantity: 99 });
    await service.checkout(stranger, { idempotencyKey: randomUUID() });
    const first = await service.list(actor, {
      statuses: ['PENDING_PAYMENT'],
      page: { limit: 2 },
    });
    expect(first.items.map((order) => order.id)).toEqual(
      accepted.slice(0, 2).map((order) => order.id),
    );
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(actor, {
      statuses: ['PENDING_PAYMENT'],
      page: { limit: 2, cursor: first.nextCursor },
    });
    expect(second.items.map((order) => order.id)).toEqual([accepted[2]!.id]);
    for (const order of [...first.items, ...second.items]) {
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        orderId: order.id,
        productId: product.id,
        quantity: 2,
        priceMinor: 125,
      });
    }
    expect(
      (await service.list(actor, { statuses: ['CONFIRMED'] })).items,
    ).toEqual([]);
    expect(
      (await service.list(actor, { statuses: ['DRAFT'] })).items[0]!.items[0]!
        .quantity,
    ).toBe(7);
  });

  it('reconciles a successful charge when persisting PAID failed', async () => {
    const accepted = await checkout();
    await admin.query(
      `ALTER TABLE ${schema}.orders ADD CONSTRAINT interrupt_paid CHECK (status <> 'PAID') NOT VALID`,
    );
    try {
      await expect(process.resume(accepted.id)).rejects.toThrow();
      expect(await state(accepted.id)).toMatchObject({
        status: 'PENDING_PAYMENT',
        captureIntentRecorded: true,
      });
      expect(payment.status).toBe('SUCCEEDED');
    } finally {
      await admin.query(
        `ALTER TABLE ${schema}.orders DROP CONSTRAINT interrupt_paid`,
      );
    }
    await restart();
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'CONFIRMED',
    });
    expect(charges.size).toBe(1);
    expect(refunds.size).toBe(0);
  });

  it('retains compensation until an unresolved payment settles', async () => {
    const accepted = await checkout();
    payments.capture = vi.fn<Payments['capture']>(async () => ({
      status: 'PENDING',
    }));
    await process.resume(accepted.id);
    expect(await process.cancel(actor.id, accepted.id)).toMatchObject({
      status: 'CANCELED',
    });
    expect(await state(accepted.id)).toMatchObject({
      compensationPending: true,
    });
    expect(refunds.size).toBe(0);
    await restart();
    payment = { status: 'SUCCEEDED' };
    const errors: unknown[] = [];
    await recovery.run((error) => errors.push(error));
    expect(errors).toEqual([]);
    expect(await state(accepted.id)).toMatchObject({
      status: 'CANCELED',
      compensationPending: false,
    });
    expect([...refunds]).toEqual([`${accepted.id}:refund`]);
  });

  it('persists business failure and its notification without charging', async () => {
    const accepted = await checkout();
    vi.spyOn(inventory, 'reserve').mockRejectedValueOnce(
      new DomainError('FAILED_PRECONDITION', 'out of stock'),
    );
    await expect(process.resume(accepted.id)).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(await state(accepted.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'out of stock',
      compensationPending: false,
    });
    expect(charges.size).toBe(0);
    const notifications = await messages.claim({
      owner: 'test',
      now: Date.now(),
      leaseMs: 30_000,
      limit: 10,
    });
    expect(
      notifications
        .filter((event) => event.topic === TOPICS.notification)
        .map((event) => event.payload),
    ).toMatchObject([
      { payload: { status: 'PENDING_PAYMENT' } },
      {
        title: 'Order failed',
        body: 'out of stock',
        payload: { status: 'FAILED', failure_reason: 'out of stock' },
      },
    ]);
  });

  it('uses the persisted capture intent when compensating a declined payment', async () => {
    const accepted = await checkout();
    const getByOrder = vi.spyOn(payments, 'getByOrder');
    const refund = vi.spyOn(payments, 'refund');
    payments.capture = vi.fn(async () => {
      payment = { status: 'FAILED', failureMessage: 'declined' };
      return payment;
    });
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'declined',
    });
    expect(await state(accepted.id)).toMatchObject({
      captureIntentRecorded: true,
      compensationPending: false,
    });
    expect(getByOrder).toHaveBeenCalledWith(accepted.id);
    expect(refund).not.toHaveBeenCalled();
    expect([...releases]).toEqual([`${accepted.id}:reserve`]);
    expect(await repository.recoverableIds()).not.toContain(accepted.id);
  });

  it('stops recovery between attempts without draining and leaves skipped orders recoverable', async () => {
    await checkout();
    await checkout();
    const ids = await repository.recoverableIds();
    expect(ids).toHaveLength(2);
    const [first, skipped] = ids;
    let enter!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resume = vi.fn<CheckoutSaga['tryResume']>(async (id) => {
      enter();
      await gate;
      return service.get(actor, id);
    });
    const saga = createMock<CheckoutSaga>({ tryResume: resume });
    const scheduler = new RecoveryScheduler(repository, saga);
    const restarted = new RecoveryScheduler(repository, process);
    const running = scheduler.run();

    try {
      await started;
      await scheduler.run();
      expect(resume).toHaveBeenCalledTimes(1);
      expect(scheduler.onModuleDestroy()).toBeUndefined();

      const attempts = () =>
        admin.query(
          `SELECT id, recovery_attempted_at FROM ${schema}.orders ORDER BY recovery_attempted_at NULLS LAST`,
        );
      const before = (await attempts()).rows;
      expect(before).toEqual([
        { id: first, recovery_attempted_at: expect.any(Date) },
        { id: skipped, recovery_attempted_at: null },
      ]);
      release();
      await running;
      expect(resume).toHaveBeenCalledExactlyOnceWith(first);
      expect((await attempts()).rows).toEqual(before);
      await scheduler.run();
      expect((await attempts()).rows).toEqual(before);
      expect(await repository.recoverableIds()).toContain(skipped);

      await restarted.run();
      expect(await state(skipped!)).toMatchObject({ status: 'CONFIRMED' });
      expect(await repository.recoverableIds()).not.toContain(skipped);
    } finally {
      release();
      await running;
      scheduler.onModuleDestroy();
      restarted.onModuleDestroy();
    }
  });

  it('keeps recovery attempts out of business timestamps', async () => {
    const accepted = await checkout();
    await repository.recoveryAttempted(accepted.id);
    expect(await service.get(actor, accepted.id)).toEqual(accepted);
    const result = await admin.query(
      `SELECT recovery_attempted_at FROM ${schema}.orders WHERE id = $1`,
      [accepted.id],
    );
    expect(result.rows[0].recovery_attempted_at).toBeInstanceOf(Date);
  });

  it('does not start Saga if shutdown happens during recovery bookkeeping', async () => {
    const accepted = await checkout();
    const resume = vi.spyOn(process, 'tryResume');
    vi.spyOn(repository, 'recoveryAttempted').mockImplementationOnce(
      async () => {
        recovery.onModuleDestroy();
      },
    );

    await recovery.run();
    expect(resume).not.toHaveBeenCalled();
    expect((await state(accepted.id)).status).toBe('PENDING_PAYMENT');
    await new RecoveryScheduler(repository, process).run();
    expect((await state(accepted.id)).status).toBe('CONFIRMED');
  });

  it('releases the recovery guard after a lookup failure and reports downstream UNAVAILABLE', async () => {
    const accepted = await checkout();
    const lookupError = new Error('database unavailable');
    const rpcError = new DomainError('UNAVAILABLE', 'inventory unavailable');
    vi.spyOn(repository, 'recoverableIds').mockRejectedValueOnce(lookupError);
    vi.spyOn(inventory, 'reserve').mockRejectedValueOnce(rpcError);
    const errors: unknown[] = [];
    const report = (error: unknown) => errors.push(error);

    await recovery.run(report);
    await recovery.run(report);
    expect(errors).toEqual([lookupError, rpcError]);
    expect((await state(accepted.id)).status).toBe('PENDING_PAYMENT');
    await recovery.run(report);
    expect(errors).toEqual([lookupError, rpcError]);
    expect((await state(accepted.id)).status).toBe('CONFIRMED');
    expect(charges.size).toBe(1);
  });

  it('keeps a missing reservation recoverable until its original deadline', async () => {
    const accepted = await checkout();
    const capture = vi.spyOn(payments, 'capture');
    vi.spyOn(inventory, 'release').mockRejectedValue(
      new DomainError('NOT_FOUND', 'reserve may still be in flight'),
    );
    await process.cancel(actor.id, accepted.id);
    expect(await state(accepted.id)).toMatchObject({
      compensationPending: true,
    });
    expect(capture).not.toHaveBeenCalled();
    await admin.query(
      `UPDATE ${schema}.orders SET payment_timeout_at = now() - interval '1 second' WHERE id = $1`,
      [accepted.id],
    );
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'CANCELED',
    });
    expect(await state(accepted.id)).toMatchObject({
      compensationPending: false,
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('settles and refunds a durable capture intent even after timeout', async () => {
    const accepted = await checkout();
    const commit = vi.spyOn(inventory, 'commit');
    vi.spyOn(payments, 'capture').mockRejectedValueOnce(
      new DomainError('UNAVAILABLE', 'capture not sent'),
    );
    await expect(process.resume(accepted.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await admin.query(
      `UPDATE ${schema}.orders SET payment_timeout_at = now() - interval '1 second' WHERE id = $1`,
      [accepted.id],
    );
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'payment timed out',
    });
    expect(await state(accepted.id)).toMatchObject({
      compensationPending: false,
    });
    expect([...charges]).toEqual([`${accepted.id}:capture`]);
    expect([...refunds]).toEqual([`${accepted.id}:refund`]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('refunds a paid order when inventory commit has a business failure', async () => {
    const accepted = await checkout();
    vi.spyOn(inventory, 'commit').mockRejectedValueOnce(
      new DomainError('FAILED_PRECONDITION', 'reservation expired'),
    );
    expect(await process.resume(accepted.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'reservation expired',
    });
    expect(await state(accepted.id)).toMatchObject({
      captureIntentRecorded: true,
      compensationPending: false,
    });
    expect([...refunds]).toEqual([`${accepted.id}:refund`]);
  });

  async function blockedBy(pid: number, query: string, count = 1) {
    let rows: { pid: number }[] = [];
    await vi.waitFor(
      async () => {
        rows = (
          await admin.query(
            `WITH RECURSIVE blocked AS (
               SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
               UNION
               SELECT a.pid FROM pg_stat_activity a
               JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
             )
             SELECT a.pid FROM pg_stat_activity a JOIN blocked b USING (pid)
             WHERE a.query ILIKE $2`,
            [pid, query],
          )
        ).rows;
        expect(rows).toHaveLength(count);
      },
      { timeout: 5_000, interval: 10 },
    );
    return rows;
  }

  it.each(['before pricing', 'during pricing'] as const)(
    '%s: rechecks replay after the final cart lock wait when acceptance removes the draft',
    async (phase) => {
      const cart = await service.addToCart(actor, {
        productId: product.id,
        quantity: 2,
      });
      const firstService = service;
      const firstCatalog = catalog;
      await connect();
      const key = randomUUID();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (phase === 'during pricing') {
        vi.spyOn(firstCatalog, 'getProduct').mockImplementationOnce(
          async () => {
            enter();
            await gate;
            return product;
          },
        );
      }
      const blocker = await admin.connect();
      const {
        rows: [{ pid }],
      } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('BEGIN');
      await blocker.query(`LOCK TABLE ${schema}_outbox.messages IN SHARE MODE`);
      let loser: ReturnType<OrdersService['checkout']> | undefined;
      let winner: ReturnType<OrdersService['checkout']> | undefined;
      try {
        if (phase === 'during pricing') {
          loser = firstService.checkout(actor, { idempotencyKey: key });
          await entered;
        }
        winner = service.checkout(actor, { idempotencyKey: key });
        const [waiting] = await blockedBy(pid, '%insert into%messages%');
        if (phase === 'before pricing') {
          loser = firstService.checkout(actor, { idempotencyKey: key });
        } else {
          release();
        }
        // Initial replay has missed: this request is now waiting on the parent.
        await blockedBy(waiting!.pid, '%for update%');
        await blocker.query('COMMIT');
        const accepted = await winner;
        expect(await loser).toEqual(accepted);
        expect(accepted.items[0]!.id).toBe(cart.items[0]!.id);
        expect(await repository.cart(actor.id)).toBeUndefined();
        expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
      } finally {
        release();
        await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.allSettled([winner, loser]);
      }
    },
  );

  it('rolls back a losing acceptance before replaying an exact checkout key conflict', async () => {
    const accepted = await checkout();
    const cart = await service.addToCart(actor, {
      productId: product.id,
      quantity: 7,
    });
    const key = randomUUID();
    const blocker = await admin.connect();
    const {
      rows: [{ pid }],
    } = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('BEGIN');
    await blocker.query(`LOCK TABLE ${schema}_outbox.messages IN SHARE MODE`);
    const running = service.checkout(actor, { idempotencyKey: key });
    try {
      // Acceptance has passed both replay reads and locked the second cart.
      await blockedBy(pid, '%insert into%messages%');
      await blocker.query(
        `INSERT INTO ${schema}.checkout_idempotency (user_id, key, response)
         SELECT user_id, $1, response FROM ${schema}.checkout_idempotency`,
        [key],
      );
      await blocker.query('COMMIT');
      expect(await running).toEqual(accepted);
      expect(await service.getCart(actor)).toEqual(cart);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.allSettled([running]);
    }
  });

  it.each(['cart', 'checkout'] as const)(
    'propagates unrelated unique violations from %s writes',
    async (operation) => {
      await checkout();
      const cart = await service.addToCart(actor, {
        productId: product.id,
        quantity: 2,
      });
      const index = 'unrelated_unique';
      const table =
        operation === 'cart'
          ? `${schema}.order_items`
          : `${schema}_outbox.messages`;
      // Existing checkout and draft share a seller, so constrain product name only
      // on the draft's items for the mutation case.
      await admin.query(
        operation === 'cart'
          ? `CREATE UNIQUE INDEX ${index} ON ${table} (seller_id) WHERE order_id = '${cart.id}'`
          : `CREATE UNIQUE INDEX ${index} ON ${table} ((true)) WHERE topic = 'notification.events'`,
      );
      try {
        vi.spyOn(catalog, 'getProduct').mockImplementation(async (id) => ({
          ...product,
          id,
        }));
        const running =
          operation === 'cart'
            ? service.addToCart(actor, { productId: randomUUID(), quantity: 3 })
            : service.checkout(actor, { idempotencyKey: randomUUID() });
        await expect(running).rejects.toMatchObject({
          cause: { code: '23505', constraint: index },
        });
        expect(await service.getCart(actor)).toEqual(cart);
        expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
      } finally {
        await admin.query(
          `DROP INDEX ${operation === 'cart' ? schema : `${schema}_outbox`}.${index}`,
        );
      }
    },
  );

  it.each(['same', 'different'] as const)(
    'retries concurrent first adds for %s products without losing either add',
    async (kind) => {
      vi.spyOn(catalog, 'getProduct').mockImplementation(async (id) => ({
        ...product,
        id,
      }));
      const blocker = await admin.connect();
      const {
        rows: [{ pid }],
      } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('BEGIN');
      await blocker.query(`LOCK TABLE ${schema}.orders IN SHARE MODE`);
      const secondId = kind === 'same' ? product.id : randomUUID();
      const adds = [
        service.addToCart(actor, { productId: product.id, quantity: 2 }),
        service.addToCart(actor, { productId: secondId, quantity: 3 }),
      ];
      try {
        await blockedBy(pid, '%insert into "orders"%', 2);
        await blocker.query('COMMIT');
        await Promise.all(adds);
        const cart = await service.getCart(actor);
        expect(cart.items).toHaveLength(kind === 'same' ? 1 : 2);
        expect(cart.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(
          5,
        );
        expect(new Set(cart.items.map((item) => item.productId))).toEqual(
          new Set([product.id, secondId]),
        );
        expect(
          (
            await admin.query(
              `SELECT id FROM ${schema}.orders WHERE status = 'DRAFT'`,
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.allSettled(adds);
      }
    },
  );

  it('serializes existing cart adds without losing updates or item identities', async () => {
    const cart = await service.addToCart(actor, {
      productId: product.id,
      quantity: 2,
    });
    const blocker = await admin.connect();
    const {
      rows: [{ pid }],
    } = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('BEGIN');
    await blocker.query(
      `SELECT id FROM ${schema}.orders WHERE id = $1 FOR UPDATE`,
      [cart.id],
    );
    const adds = [3, 4].map((quantity) =>
      service.addToCart(actor, { productId: product.id, quantity }),
    );
    try {
      await blockedBy(pid, '%for update%', 2);
      await blocker.query('COMMIT');
      await Promise.all(adds);
      expect((await service.getCart(actor)).items).toEqual([
        { ...cart.items[0]!, quantity: 9 },
      ]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.allSettled(adds);
    }
  });

  it.each(['read', 'add'] as const)(
    'follows draft turnover during a blocked cart %s',
    async (operation) => {
      const cart = await service.addToCart(actor, {
        productId: product.id,
        quantity: 2,
      });
      const blocker = await admin.connect();
      const {
        rows: [{ pid }],
      } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT id FROM ${schema}.orders WHERE id = $1 FOR UPDATE`,
        [cart.id],
      );
      const running =
        operation === 'read'
          ? service.getCart(actor)
          : service.addToCart(actor, { productId: product.id, quantity: 3 });
      try {
        await blockedBy(pid, '%for update%');
        await blocker.query(
          `UPDATE ${schema}.orders SET status = 'CANCELED' WHERE id = $1`,
          [cart.id],
        );
        const replacement = randomUUID();
        await blocker.query(
          `INSERT INTO ${schema}.orders (id, user_id) VALUES ($1, $2)`,
          [replacement, actor.id],
        );
        await blocker.query(
          `INSERT INTO ${schema}.order_items (order_id, product_id, seller_id, product_name, quantity)
           SELECT $1, product_id, seller_id, product_name, 7 FROM ${schema}.order_items WHERE order_id = $2`,
          [replacement, cart.id],
        );
        await blocker.query('COMMIT');
        expect(await running).toMatchObject({
          id: replacement,
          items: [{ quantity: operation === 'read' ? 7 : 10 }],
        });
        expect((await service.get(actor, cart.id)).items[0]!.quantity).toBe(2);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.allSettled([running]);
      }
    },
  );

  it('replays checkout acceptance across replicas and restarts without consuming another cart', async () => {
    await service.addToCart(actor, { productId: product.id, quantity: 2 });
    const key = randomUUID();
    const firstService = service;
    await connect();
    const [first, replay] = await Promise.all([
      firstService.checkout(actor, { idempotencyKey: key }),
      service.checkout(actor, { idempotencyKey: key }),
    ]);
    expect(replay).toMatchObject({
      id: first.id,
      status: 'PENDING_PAYMENT',
      totalMinor: 250,
    });
    expect(replay).toEqual(first);
    await process.resume(first.id);
    await service.addToCart(actor, { productId: product.id, quantity: 7 });
    await restart();
    expect(await service.checkout(actor, { idempotencyKey: key })).toEqual(
      first,
    );
    expect((await service.getCart(actor)).items[0]!.quantity).toBe(7);
    expect(
      (await service.list(actor, { statuses: ['CONFIRMED'] })).items,
    ).toHaveLength(1);
  });

  it.each(['quantity', 'replacement'] as const)(
    'prices without holding a connection and rejects concurrent cart %s changes',
    async (change) => {
      const cart = await service.addToCart(actor, {
        productId: product.id,
        quantity: 2,
      });
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(catalog, 'getProduct').mockImplementationOnce(async () => {
        enter();
        await gate;
        return product;
      });
      const key = randomUUID();
      const running = service.checkout(actor, { idempotencyKey: key });
      const rejected = expect(running).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        message: 'cart changed during pricing; retry checkout',
      });
      try {
        await entered;
        expect(pool.idleCount).toBe(pool.totalCount);
        if (change === 'quantity') {
          const updated = await service.updateCartItem(actor, {
            orderItemId: cart.items[0]!.id,
            quantity: 5,
          });
          expect(updated.items[0]!.quantity).toBe(5);
        } else {
          await service.cancel(actor, cart.id);
          const replacement = await service.addToCart(actor, {
            productId: product.id,
            quantity: 5,
          });
          expect(replacement.id).not.toBe(cart.id);
        }
      } finally {
        release();
        await rejected;
      }
      expect((await service.getCart(actor)).status).toBe('DRAFT');
      expect(await messages.stats(Date.now())).toMatchObject({
        pending: change === 'quantity' ? 0 : 1,
      });
      expect(
        await service.checkout(actor, { idempotencyKey: key }),
      ).toMatchObject({ totalMinor: 625 });
      const pricing = vi.spyOn(catalog, 'getProduct');
      pricing.mockClear();
      await service.checkout(actor, { idempotencyKey: key });
      expect(pricing).not.toHaveBeenCalled();
    },
  );

  it('returns concurrent same-key acceptance before checking the now-replaced cart', async () => {
    await service.addToCart(actor, { productId: product.id, quantity: 2 });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(catalog, 'getProduct').mockImplementationOnce(async () => {
      enter();
      await gate;
      return product;
    });
    const key = randomUUID();
    const running = service.checkout(actor, { idempotencyKey: key });
    try {
      await entered;
      await connect();
      const accepted = await service.checkout(actor, { idempotencyKey: key });
      const replacement = await service.addToCart(actor, {
        productId: product.id,
        quantity: 7,
      });
      release();
      expect(await running).toEqual(accepted);
      expect(await service.getCart(actor)).toEqual(replacement);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    } finally {
      release();
      await running;
    }
  });

  it('updates only the changed position and preserves referenced item identities', async () => {
    vi.spyOn(catalog, 'getProduct').mockImplementation(async (id) => ({
      ...product,
      id,
    }));
    const first = await service.addToCart(actor, {
      productId: product.id,
      quantity: 2,
    });
    const itemId = first.items[0]!.id;
    const second = await service.addToCart(actor, {
      productId: randomUUID(),
      quantity: 3,
    });
    const untouched = second.items.find((item) => item.id !== itemId)!;
    const before = await admin.query(
      `SELECT xmin::text FROM ${schema}.order_items WHERE id = $1`,
      [untouched.id],
    );
    await admin.query(
      `CREATE TABLE ${schema}.item_reference (item_id uuid REFERENCES ${schema}.order_items(id))`,
    );
    try {
      await admin.query(`INSERT INTO ${schema}.item_reference VALUES ($1)`, [
        itemId,
      ]);
      const updated = await service.updateCartItem(actor, {
        orderItemId: itemId,
        quantity: 5,
      });
      expect(updated.items.find((item) => item.id === itemId)).toMatchObject({
        quantity: 5,
        createdAt: first.items[0]!.createdAt,
      });
      expect(
        (
          await admin.query(
            `SELECT xmin::text FROM ${schema}.order_items WHERE id = $1`,
            [untouched.id],
          )
        ).rows,
      ).toEqual(before.rows);
      const merged = await service.addToCart(actor, {
        productId: product.id,
        quantity: 1,
      });
      expect(merged.items.find((item) => item.id === itemId)!.quantity).toBe(6);
      expect(
        (await service.removeCartItem(actor, { orderItemId: untouched.id }))
          .items,
      ).toHaveLength(1);
    } finally {
      await admin.query(`DROP TABLE ${schema}.item_reference`);
    }
  });
});
