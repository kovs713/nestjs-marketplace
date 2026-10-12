import { Outbox, OutboxRelay, OutboxStorage } from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

import { DomainError } from '@app/common';

import { providerSucceeded } from '../src/domain/payment.fixtures.js';
import { PaymentRepository } from '../src/payment.repository.js';
import { PaymentService } from '../src/payment.service.js';

// Run: bunx vitest run --config vitest.config.e2e.ts apps/payment-service/test
// Starts PostgreSQL 18 via Testcontainers unless PAYMENT_TEST_DATABASE_URL is set.
const url = process.env.PAYMENT_TEST_DATABASE_URL;
const schema = `payment_test_${randomUUID().replaceAll('-', '')}`;

describe('Payment atomicity and concurrency (PostgreSQL)', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: PaymentRepository;
  let service: PaymentService;
  let outbox: Outbox;
  let provider = {
    capture: vi.fn(() => providerSucceeded),
    refundReference: vi.fn(() => 'refund-ref'),
  };

  const request = () => ({
    orderId: randomUUID(),
    userId: randomUUID(),
    amountMinor: 100,
    method: 'CARD' as const,
    idempotencyKey: randomUUID(),
  });
  const operation = (orderId: string) => ({
    orderId,
    idempotencyKey: randomUUID(),
  });
  const count = async (table: string) =>
    Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  // Both transactions have read their order and key before either writes.
  const raceWrites = () => {
    const save = repository.saveWithHistoryAndOutbox.bind(repository);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrivals = 0;
    return vi
      .spyOn(repository, 'saveWithHistoryAndOutbox')
      .mockImplementation(async (...args) => {
        if (++arrivals === 2) release();
        await ready;
        return save(...args);
      });
  };

  beforeAll(async () => {
    if (!url)
      throw new Error(
        'Set PAYMENT_TEST_DATABASE_URL to disposable PostgreSQL 18',
      );
    admin = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: url,
      max: 12,
      options: `-c search_path=${schema},public`,
    });
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const dir of (await readdir(migrations)).sort())
      await pool.query(
        await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'),
      );
    const db = drizzle({ client: pool });
    const storage = new OutboxStorage();
    const messages = new PostgresOutboxStore(
      {
        executor: fromDrizzle(db),
        schema: `${schema}_outbox`,
      },
      storage,
    );
    await messages.onModuleInit();
    outbox = new Outbox(
      storage,
      new OutboxRelay({
        store: messages,
        transports: {},
        relay: { enabled: false },
      }),
    );
    repository = new PaymentRepository(db, outbox);
  });

  beforeEach(() => {
    provider = {
      capture: vi.fn(() => providerSucceeded),
      refundReference: vi.fn(() => 'refund-ref'),
    };
    service = new PaymentService(provider, repository);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (pool) {
      await pool.query(
        'TRUNCATE payments, payment_history, payment_idempotency',
      );
      await pool.query(`TRUNCATE ${schema}_outbox.messages`);
    }
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS ${schema}_outbox CASCADE`);
      await admin.end();
    }
  });

  it('serializes create/capture/refund, preserving references and exact replays', async () => {
    const input = request();
    const created = await Promise.all(
      Array.from({ length: 8 }, () => service.create(input)),
    );
    expect(new Set(created.map((p) => p.id)).size).toBe(1);
    expect(created[0].status).toBe('PENDING');
    expect(provider.capture).not.toHaveBeenCalled();
    expect(await count('payments')).toBe(1);

    const capture = operation(input.orderId);
    const captured = await Promise.all(
      Array.from({ length: 8 }, () => service.capture(capture)),
    );
    expect(captured.every((p) => p.status === 'SUCCEEDED')).toBe(true);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        service.capture(operation(input.orderId)),
      ),
    );
    expect(provider.capture).toHaveBeenCalledTimes(1);

    const refunded = await Promise.all(
      Array.from({ length: 8 }, () => service.refund(operation(input.orderId))),
    );
    expect(
      refunded.every(
        (p) =>
          p.providerRef === providerSucceeded.providerRef &&
          p.refundProviderRef === 'refund-ref',
      ),
    ).toBe(true);
    expect(provider.refundReference).toHaveBeenCalledTimes(1);
    expect(await service.capture(capture)).toEqual(captured[0]);
    await expect(
      service.capture(operation(input.orderId)),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect(provider.capture).toHaveBeenCalledTimes(1);
    const history = await service.listHistory({
      paymentId: created[0].id,
      page: undefined,
    });
    expect(history.items.map((p) => [p.sequence, p.status])).toEqual([
      [1, 'PENDING'],
      [2, 'SUCCEEDED'],
      [3, 'REFUNDED'],
    ]);
    expect(await count('payment_history')).toBe(3);
    expect(await count(`${schema}_outbox.messages`)).toBe(2);
  });

  it('rejects changed create input and conflicting cross-order idempotency keys', async () => {
    const input = request();
    await service.create(input);
    await expect(
      service.create({ ...input, amountMinor: 101 }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await expect(
      service.create({
        ...input,
        amountMinor: 101,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    raceWrites();
    const results = await Promise.allSettled([
      service.create({ ...request(), idempotencyKey: 'shared-create-key' }),
      service.create({ ...request(), idempotencyKey: 'shared-create-key' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'ALREADY_EXISTS' },
    });
    expect(await count('payments')).toBe(2);
    expect(await count('payment_history')).toBe(2);
    expect(await count('payment_idempotency')).toBe(2);
    expect(await count(`${schema}_outbox.messages`)).toBe(0);
  });

  it('retries same-order create collisions and saves both matching keys', async () => {
    const input = request();
    const other = { ...input, idempotencyKey: randomUUID() };
    raceWrites();
    const results = await Promise.all([
      service.create(input),
      service.create(other),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await service.create(input)).toEqual(results[0]);
    expect(await service.create(other)).toEqual(results[0]);
    expect(await count('payments')).toBe(1);
    expect(await count('payment_history')).toBe(1);
    expect(await count('payment_idempotency')).toBe(2);
    expect(await count(`${schema}_outbox.messages`)).toBe(0);
  });

  it('rejects different input after a same-order create collision', async () => {
    const input = request();
    raceWrites();
    const results = await Promise.allSettled([
      service.create(input),
      service.create({
        ...input,
        amountMinor: 101,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: {
        code: 'ALREADY_EXISTS',
        message: 'payment already exists for order',
      },
    });
    expect(await count('payments')).toBe(1);
    expect(await count('payment_history')).toBe(1);
    expect(await count('payment_idempotency')).toBe(1);
  });

  it.each(['create', 'capture', 'refund'] as const)(
    'rechecks committed keys after a %s business guard rolls back',
    async (operation) => {
      const winner = request();
      const loser = request();
      await service.create(loser);
      if (operation !== 'create') {
        await service.create(winner);
        await service.capture(
          operation === 'refund'
            ? { orderId: winner.orderId, idempotencyKey: randomUUID() }
            : { orderId: loser.orderId, idempotencyKey: randomUUID() },
        );
        if (operation === 'capture')
          await service.refund({
            orderId: loser.orderId,
            idempotencyKey: randomUUID(),
          });
      }
      const key = randomUUID();
      // Commit the winning key after the loser's last in-transaction key read.
      const lookup = repository.idempotent.bind(repository);
      vi.spyOn(repository, 'idempotent')
        .mockImplementationOnce(lookup)
        .mockImplementationOnce(async () => {
          await service[operation]({ ...winner, idempotencyKey: key });
          return undefined;
        });
      await expect(
        service[operation]({ ...loser, amountMinor: 101, idempotencyKey: key }),
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
        message: 'idempotency key already used with a different request',
      });
    },
  );

  it('replays a committed result after a missing-payment guard rolls back', async () => {
    const input = request();
    let response: Awaited<ReturnType<PaymentService['capture']>> | undefined;
    const lookup = repository.idempotent.bind(repository);
    vi.spyOn(repository, 'idempotent')
      .mockImplementationOnce(lookup)
      .mockImplementationOnce(async () => {
        await service.create(input);
        response = await service.capture(input);
        return undefined;
      });
    const result = await service.capture(input);
    expect(result).toEqual(response);
    expect(result.status).toBe('SUCCEEDED');
    expect(provider.capture).toHaveBeenCalledTimes(1);
    expect(await count('payment_history')).toBe(2);
    expect(await count(`${schema}_outbox.messages`)).toBe(1);
  });

  it('rechecks a committed key after a missing-payment guard rolls back', async () => {
    const winner = request();
    await service.create(winner);
    const key = randomUUID();
    const lookup = repository.idempotent.bind(repository);
    vi.spyOn(repository, 'idempotent')
      .mockImplementationOnce(lookup)
      .mockImplementationOnce(async () => {
        await service.capture({ orderId: winner.orderId, idempotencyKey: key });
        return undefined;
      });
    await expect(
      service.capture({ orderId: randomUUID(), idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it.each([
    { code: '23505', constraint: 'payment_history_payment_sequence' },
    { code: '23505', constraint: 'payments_pkey' },
    { code: '23503', constraint: 'payment_idempotency_operation_key' },
    { code: '08006' },
  ])('preserves unrelated database failures: %j', async (failure) => {
    const winner = request();
    const loser = request();
    const error = Object.assign(new Error('database failure'), failure);
    vi.spyOn(repository, 'saveWithHistoryAndOutbox').mockImplementationOnce(
      async () => {
        await service.create({
          ...winner,
          idempotencyKey: loser.idempotencyKey,
        });
        throw error;
      },
    );
    await expect(service.create(loser)).rejects.toBe(error);
    expect(await count('payments')).toBe(1);
  });

  it('returns consistent read models and preserves missing-payment errors', async () => {
    const input = request();
    const created = await service.create(input);
    expect(await service.get({ id: created.id })).toEqual(created);
    expect(await service.getByOrder(input)).toEqual(created);
    expect(
      await service.list({ userId: input.userId, statuses: ['PENDING'] }),
    ).toMatchObject({ items: [created] });
    expect((await service.list({ statuses: ['REFUNDED'] })).items).toEqual([]);
    await expect(service.get({ id: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.getByOrder({ orderId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.capture(operation(randomUUID())),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.refund(operation(randomUUID()))).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
  });

  it('appends after the highest history sequence, not the row count', async () => {
    const input = request();
    const created = await service.create(input);
    await pool.query(
      'UPDATE payment_history SET sequence = 4 WHERE payment_id = $1',
      [created.id],
    );
    await service.capture(operation(input.orderId));
    expect(
      (
        await service.listHistory({ paymentId: created.id, page: undefined })
      ).items.map((p) => p.sequence),
    ).toEqual([4, 5]);
  });

  it('rolls back cross-order capture/refund key collisions', async () => {
    const inputs = [request(), request()];
    await Promise.all(inputs.map((input) => service.create(input)));
    const writes = raceWrites();
    const capture = await Promise.allSettled(
      inputs.map((input) =>
        service.capture({
          orderId: input.orderId,
          idempotencyKey: 'shared-capture-key',
        }),
      ),
    );
    expect(capture.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(capture.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'ALREADY_EXISTS' },
    });
    expect(await count('payment_history')).toBe(3);
    expect(await count(`${schema}_outbox.messages`)).toBe(1);
    writes.mockRestore();
    await Promise.all(
      inputs.map((input) => service.capture(operation(input.orderId))),
    );
    raceWrites();
    const refunds = await Promise.allSettled(
      inputs.map((input) =>
        service.refund({
          orderId: input.orderId,
          idempotencyKey: 'shared-refund-key',
        }),
      ),
    );
    expect(refunds.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refunds.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'ALREADY_EXISTS' },
    });
    expect(await count('payment_history')).toBe(5);
    expect(await count(`${schema}_outbox.messages`)).toBe(3);
  });

  it('rolls back transient errors and keeps business declines terminal', async () => {
    const input = request();
    await service.create(input);
    const capture = operation(input.orderId);
    vi.mocked(provider.capture).mockImplementationOnce(() => {
      throw new DomainError('UNAVAILABLE', 'temporary');
    });
    await expect(service.capture(capture)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect((await service.getByOrder(input)).status).toBe('PENDING');
    expect(await count('payment_history')).toBe(1);
    expect(await count(`${schema}_outbox.messages`)).toBe(0);
    expect(
      await repository.idempotent('capture', capture.idempotencyKey),
    ).toBeUndefined();
    vi.mocked(provider.capture).mockReturnValueOnce({
      ...providerSucceeded,
      failureCode: 'DECLINED',
      failureMessage: 'declined',
    });
    const declined = await service.capture(capture);
    expect(declined).toMatchObject({
      status: 'FAILED',
      failureCode: 'DECLINED',
      failureMessage: 'declined',
    });
    expect(await service.capture(capture)).toEqual(declined);
    expect((await service.capture(operation(input.orderId))).status).toBe(
      'FAILED',
    );
    expect(provider.capture).toHaveBeenCalledTimes(2);
    expect(await count('payment_history')).toBe(2);
    expect(await count(`${schema}_outbox.messages`)).toBe(1);
    await expect(
      service.refund(operation(input.orderId)),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rolls back payment, history and idempotency when Outbox fails', async () => {
    const input = request();
    await service.create(input);
    const capture = operation(input.orderId);
    vi.spyOn(outbox, 'add').mockRejectedValueOnce(
      new Error('outbox unavailable'),
    );
    await expect(service.capture(capture)).rejects.toThrow(
      'outbox unavailable',
    );
    expect((await service.getByOrder(input)).status).toBe('PENDING');
    expect(await count('payment_history')).toBe(1);
    expect(
      await repository.idempotent('capture', capture.idempotencyKey),
    ).toBeUndefined();
    expect((await service.capture(capture)).status).toBe('SUCCEEDED');
    expect(await count(`${schema}_outbox.messages`)).toBe(1);
  });

  it('pages history by sequence even when UUID order differs', async () => {
    const payment = await service.create(request());
    await pool.query('DELETE FROM payment_history');
    const ids = [1, 2, 3].map(
      (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    );
    for (const [index, id] of ids.entries()) {
      await pool.query(
        'INSERT INTO payment_history (id, payment_id, sequence, status) VALUES ($1, $2, $3, $4)',
        [id, payment.id, 3 - index, 'PENDING'],
      );
    }
    await service.create(request());
    const first = await service.listHistory({
      paymentId: payment.id,
      page: { limit: 2, cursor: '' },
    });
    const second = await service.listHistory({
      paymentId: payment.id,
      page: { limit: 2, cursor: first.nextCursor },
    });
    expect(first.items.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(first.items.map((p) => p.sequence)).toEqual([1, 2]);
    expect(first.nextCursor).toBe('2');
    expect(second.items.map((p) => p.id)).toEqual([ids[0]]);
    expect(second.items.map((p) => p.sequence)).toEqual([3]);
    expect(second.nextCursor).toBe('');
    const end = await service.listHistory({
      paymentId: payment.id,
      page: { limit: 1, cursor: '2' },
    });
    expect(end.nextCursor).toBe('3');
    expect(
      await service.listHistory({
        paymentId: payment.id,
        page: { limit: 1, cursor: end.nextCursor },
      }),
    ).toEqual({ items: [], nextCursor: '' });
  });

  it.each([
    '0',
    '-1',
    '1.5',
    '1e2',
    '01',
    ' 2',
    'NaN',
    'Infinity',
    '2147483648',
    '9007199254740993',
    'Mg==',
    randomUUID(),
  ])('rejects invalid history cursor %s', async (cursor) => {
    await expect(
      service.listHistory({
        paymentId: randomUUID(),
        page: { limit: 0, cursor },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
