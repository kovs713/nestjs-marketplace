import { createMock } from '@golevelup/ts-vitest';
import {
  Outbox,
  OutboxInbox,
  OutboxRelay,
  OutboxStorage,
} from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

import { CHECKOUT_TIMEOUT_MS } from '@app/common';

import type { CatalogClient } from '../src/catalog/catalog.client.js';
import { ReservationRepository } from '../src/reservation/reservation.repository.js';
import { ReservationService } from '../src/reservation/reservation.service.js';
import type { ReserveRequest } from '../src/reservation/reservation.types.js';
import { StockRepository } from '../src/stock/stock.repository.js';
import { StockService } from '../src/stock/stock.service.js';

// Run: bunx vitest run --config vitest.config.e2e.ts apps/inventory-service/test
// Starts PostgreSQL 18 via Testcontainers unless INVENTORY_TEST_DATABASE_URL is set.
// Real transactions/inbox/outbox, isolated schemas.
const url = process.env.INVENTORY_TEST_DATABASE_URL;
const schema = `inventory_test_${randomUUID().replaceAll('-', '')}`;
const actor = { id: randomUUID() };
const productId = randomUUID();

describe('inventory guarantees (PostgreSQL)', () => {
  let pool: Pool;
  let repository: ReservationRepository;
  let stockRepository: StockRepository;
  let stock: StockService;
  let inventory: ReservationService;
  let messages: PostgresOutboxStore;
  let inbox: OutboxInbox;
  let outbox: Outbox;

  function request(quantity = 3): ReserveRequest {
    return {
      idempotencyKey: randomUUID(),
      orderId: randomUUID(),
      items: [{ orderItemId: randomUUID(), productId, quantity }],
      expiresAt: new Date(Date.now() + CHECKOUT_TIMEOUT_MS),
    };
  }

  beforeAll(async () => {
    if (!url)
      throw new Error(
        'Set INVENTORY_TEST_DATABASE_URL to a disposable PostgreSQL 18 database',
      );
    pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schema},public`,
    });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const dir of (await readdir(migrations)).sort())
      await pool.query(
        await readFile(new URL(`${dir}/migration.sql`, migrations), 'utf8'),
      );
    const db = drizzle({ client: pool });
    const storage = new OutboxStorage();
    messages = new PostgresOutboxStore(
      { executor: fromDrizzle(db), schema: `${schema}_outbox` },
      storage,
    );
    await messages.onModuleInit();
    inbox = new OutboxInbox(storage);
    outbox = new Outbox(
      storage,
      new OutboxRelay({
        store: messages,
        transports: {},
        relay: { enabled: false },
      }),
    );
    repository = new ReservationRepository(db);
    stockRepository = new StockRepository(db, outbox);
    inventory = new ReservationService(repository, stockRepository);
    stock = new StockService(
      stockRepository,
      createMock<CatalogClient>({
        sellerId: async () => actor.id,
      }),
    );
  });

  beforeEach(async () => {
    await stock.setStock(productId, 10, actor);
    await pool.query(`TRUNCATE ${schema}_outbox.messages`);
  });

  afterEach(async () => {
    await pool.query(
      'TRUNCATE stocks, reservations, reservation_orders, reserve_idempotency',
    );
    await pool.query(`TRUNCATE ${schema}_outbox.messages`);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.query(`DROP SCHEMA IF EXISTS ${schema}_outbox CASCADE`);
      await pool.end();
    }
  });

  it('replays acceptance by key and by order without allocating twice', async () => {
    const req = request();
    const first = await inventory.reserve(req);
    expect(first.replayed).toBe(false);
    await inventory.commit({ ...req, items: [] });
    for (const idempotencyKey of [req.idempotencyKey, randomUUID()]) {
      expect(await inventory.reserve({ ...req, idempotencyKey })).toEqual({
        reservations: first.reservations,
        replayed: true,
      });
    }
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 7,
      inReserved: 0,
      revision: 3,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
  });

  it('replays an implicit deadline after expiry without extending or revalidating it', async () => {
    const { expiresAt: _expiresAt, ...req } = request();
    const first = await inventory.reserve(req);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(first.reservations[0]!.expiresAt.getTime() + 1_000);
      for (const idempotencyKey of [req.idempotencyKey, randomUUID()]) {
        expect(await inventory.reserve({ ...req, idempotencyKey })).toEqual({
          reservations: first.reservations,
          replayed: true,
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(await stock.getStock(productId)).toMatchObject({
      inReserved: 3,
      revision: 2,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it.each(['reserve', 'commit', 'release'] as const)(
    'rejects mixed-case duplicate UUIDs before %s writes',
    async (operation) => {
      const req = request();
      const item = {
        ...req.items[0]!,
        orderItemId: 'abcdefab-1234-4567-89ab-abcdefabcdef',
      };
      req.items = [
        item,
        { ...item, orderItemId: item.orderItemId.toUpperCase() },
      ];
      await expect(inventory[operation](req)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      expect(await stock.getStock(productId)).toMatchObject({
        inStock: 10,
        inReserved: 0,
        revision: 1,
      });
      expect((await pool.query('SELECT * FROM reservations')).rows).toEqual([]);
      expect(
        (await pool.query('SELECT * FROM reserve_idempotency')).rows,
      ).toEqual([]);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
    },
  );

  it('rejects conflicting keys and conflicting order contents', async () => {
    const req = request();
    await inventory.reserve(req);
    for (const idempotencyKey of [req.idempotencyKey, randomUUID()]) {
      await expect(
        inventory.reserve({
          ...req,
          idempotencyKey,
          items: [{ ...req.items[0]!, quantity: 4 }],
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    }
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 3,
    });
  });

  it('serializes duplicate requests and never oversells concurrent orders', async () => {
    const req = request(7);
    const duplicates = await Promise.all([
      inventory.reserve(req),
      inventory.reserve(req),
    ]);
    expect(duplicates.map((result) => result.replayed)).toEqual(
      expect.arrayContaining([false, true]),
    );
    await expect(inventory.reserve(request(7))).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 7,
    });
  });

  it('allows only one competing order to reserve the remaining stock', async () => {
    const results = await Promise.allSettled([
      inventory.reserve(request(7)),
      inventory.reserve(request(7)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toMatchObject([{ reason: { code: 'FAILED_PRECONDITION' } }]);
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 7,
    });
  });

  it('serializes disjoint item sets for the same order without merging them', async () => {
    const first = request();
    const other = { ...request(), orderId: first.orderId };
    const results = await Promise.allSettled([
      inventory.reserve(first),
      inventory.reserve(other),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: { code: 'ALREADY_EXISTS' } },
    ]);
    expect((await pool.query('SELECT * FROM reservations')).rows).toHaveLength(
      1,
    );
    expect(await stock.getStock(productId)).toMatchObject({
      inReserved: 3,
      revision: 2,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it('waits on the idempotency UNIQUE winner and rolls back the losing order', async () => {
    const winnerProduct = randomUUID();
    await stock.setStock(winnerProduct, 10, actor);
    await pool.query(`TRUNCATE ${schema}_outbox.messages`);
    const winner = request();
    winner.items[0]!.productId = winnerProduct;
    const loser = { ...request(), idempotencyKey: winner.idempotencyKey };
    let inserted!: () => void;
    let release!: () => void;
    let saving!: () => void;
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempted = new Promise<void>((resolve) => {
      saving = resolve;
    });
    const record = stockRepository.recordStockChanges.bind(stockRepository);
    const save = repository.saveResult.bind(repository);
    const recordSpy = vi
      .spyOn(stockRepository, 'recordStockChanges')
      .mockImplementation(async (tx, stocks) => {
        if (stocks.some((stock) => stock.productId === winnerProduct)) {
          inserted();
          await gate;
        }
        return record(tx, stocks);
      });
    const saveSpy = vi
      .spyOn(repository, 'saveResult')
      .mockImplementation(async (...args) => {
        if (args[4][0]?.orderId === loser.orderId) saving();
        return save(...args);
      });
    const winning = inventory.reserve(winner);
    let losing: Promise<unknown> | undefined;
    try {
      await ready;
      losing = inventory.reserve(loser).then(
        () => undefined,
        (error: unknown) => error,
      );
      await attempted;
      release();
      await winning;
      expect(await losing).toMatchObject({ code: 'ALREADY_EXISTS' });
      expect(await stock.getStock(productId)).toMatchObject({
        inReserved: 0,
        revision: 1,
      });
      expect(await stock.getStock(winnerProduct)).toMatchObject({
        inReserved: 3,
        revision: 2,
      });
      expect(
        (await pool.query('SELECT order_id FROM reservations')).rows,
      ).toEqual([{ order_id: winner.orderId }]);
      expect(
        (await pool.query('SELECT * FROM reserve_idempotency')).rows,
      ).toHaveLength(1);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
    } finally {
      release();
      await Promise.allSettled([winning, ...(losing ? [losing] : [])]);
      recordSpy.mockRestore();
      saveSpy.mockRestore();
    }
  });

  it('replays an identical UNIQUE conflict after rollback', async () => {
    const req = request();
    const first = await inventory.reserve(req);
    const before = await stock.getStock(productId);
    // Force both reads to miss to exercise the actual constraint and recovery path.
    const miss = vi.spyOn(repository, 'replayResult').mockResolvedValue(null);
    try {
      expect(await inventory.reserve(req)).toEqual({
        ...first,
        replayed: true,
      });
    } finally {
      miss.mockRestore();
    }
    expect(await stock.getStock(productId)).toEqual(before);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it('does not treat an unrelated UNIQUE failure as an idempotency conflict', async () => {
    const req = request();
    await inventory.reserve(req);
    const miss = vi.spyOn(repository, 'replayResult').mockResolvedValue(null);
    const error = Object.assign(new Error('unrelated unique'), {
      code: '23505',
      constraint: 'reservations_order_item',
    });
    const save = vi
      .spyOn(repository, 'saveResult')
      .mockRejectedValueOnce(error);
    try {
      await expect(inventory.reserve(req)).rejects.toBe(error);
    } finally {
      miss.mockRestore();
      save.mockRestore();
    }
  });

  it.each(['commit', 'release'] as const)(
    'applies %s once, including retries with a new key',
    async (operation) => {
      const req = request();
      await inventory.reserve(req);
      const first = await inventory[operation]({ ...req, items: [] });
      expect(first.replayed).toBe(false);
      for (const idempotencyKey of [req.idempotencyKey, randomUUID()]) {
        expect(
          await inventory[operation]({ ...req, idempotencyKey, items: [] }),
        ).toEqual({
          reservations: first.reservations,
          replayed: true,
        });
      }
      expect(await stock.getStock(productId)).toMatchObject({
        inStock: operation === 'commit' ? 7 : 10,
        inReserved: 0,
        revision: 3,
      });
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    },
  );

  it.each(['commit', 'release'] as const)(
    'rejects conflicting %s replay keys and item sets',
    async (operation) => {
      const req = request();
      await inventory.reserve(req);
      await inventory[operation]({ ...req, items: [] });
      const before = await stock.getStock(productId);
      await expect(
        inventory[operation]({ ...req, orderId: randomUUID(), items: [] }),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
      await expect(
        inventory[operation]({
          ...req,
          idempotencyKey: randomUUID(),
          items: [{ ...req.items[0]!, quantity: 4 }],
        }),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      expect(await stock.getStock(productId)).toEqual(before);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    },
  );

  it('serializes competing commit/release without moving balances twice', async () => {
    const req = request();
    await inventory.reserve(req);
    const [commit, release] = await Promise.allSettled([
      inventory.commit({ ...req, items: [] }),
      inventory.release({ ...req, items: [] }),
    ]);
    expect(release.status).toBe('fulfilled');
    const [{ status }] = (await pool.query('SELECT status FROM reservations'))
      .rows;
    expect(['committed', 'released']).toContain(status);
    if (status === 'committed') expect(commit.status).toBe('fulfilled');
    else
      expect(commit).toMatchObject({
        status: 'rejected',
        reason: { code: 'FAILED_PRECONDITION' },
      });
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: status === 'committed' ? 7 : 10,
      inReserved: 0,
      revision: 3,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
  });

  it('replays a historical expired hold without allocating stock or extending its deadline', async () => {
    const req = request();
    req.expiresAt = new Date(Date.now() - 1_000);
    const item = req.items[0]!;
    // Historical acceptance predates the current process; expiry must not erase it.
    await pool.query(
      `INSERT INTO reservations (order_id, order_item_id, product_id, quantity, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $5::timestamptz - interval '10 minutes')`,
      [req.orderId, item.orderItemId, productId, item.quantity, req.expiresAt],
    );
    await pool.query(
      'UPDATE stocks SET in_reserved = $1, revision = revision + 1 WHERE product_id = $2',
      [item.quantity, productId],
    );
    await inventory.expireReservations();
    const first = await inventory.reserve(req);
    expect(first).toMatchObject({
      replayed: true,
      reservations: [{ status: 'active', expiresAt: req.expiresAt }],
    });
    for (const idempotencyKey of [req.idempotencyKey, randomUUID()]) {
      expect(await inventory.reserve({ ...req, idempotencyKey })).toEqual(
        first,
      );
    }
    expect((await pool.query('SELECT status FROM reservations')).rows).toEqual([
      { status: 'expired' },
    ]);
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 0,
      revision: 3,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it('expires a hold once and rejects a late commit', async () => {
    const req = request();
    await inventory.reserve(req);
    await pool.query(
      "UPDATE reservations SET expires_at = now() - interval '1 second'",
    );
    await expect(inventory.commit({ ...req, items: [] })).rejects.toMatchObject(
      { code: 'FAILED_PRECONDITION' },
    );
    await inventory.expireReservations();
    await inventory.expireReservations();
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 0,
      revision: 3,
    });
    expect((await pool.query('SELECT status FROM reservations')).rows).toEqual([
      { status: 'expired' },
    ]);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
  });

  it('serializes commit against expiry without moving balances twice', async () => {
    const req = request();
    await inventory.reserve(req);
    await pool.query(
      "UPDATE reservations SET expires_at = now() - interval '1 second'",
    );
    const [commit, expiry] = await Promise.allSettled([
      inventory.commit({ ...req, items: [] }),
      inventory.expireReservations(),
    ]);
    expect(commit).toMatchObject({
      status: 'rejected',
      reason: { code: 'FAILED_PRECONDITION' },
    });
    expect(expiry.status).toBe('fulfilled');
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 0,
      revision: 3,
    });
  });

  it('locks two holds in deadline order during competing expiry and release', async () => {
    const req = request();
    req.items[0]!.orderItemId = '00000000-0000-4000-8000-000000000001';
    req.items.push({
      orderItemId: '00000000-0000-4000-8000-000000000002',
      productId,
      quantity: 2,
    });
    await inventory.reserve(req);
    // Heap/item insertion order opposes deadline order: the second hold goes first.
    await pool.query(
      `UPDATE reservations SET expires_at = now() - CASE
         WHEN order_item_id = $1 THEN interval '1 second'
         ELSE interval '2 seconds' END`,
      [req.items[0]!.orderItemId],
    );
    const names = ['release', 'expiry'].map((name) => `${schema}_${name}`);
    const workers = names.map(
      (application_name) =>
        new Pool({
          connectionString: url,
          application_name,
          max: 1,
          connectionTimeoutMillis: 5_000,
          options: `-c search_path=${schema},public`,
        }),
    );
    const [releaser, expirer] = workers.map(
      (worker) =>
        new ReservationService(
          new ReservationRepository(drizzle({ client: worker })),
          new StockRepository(drizzle({ client: worker }), outbox),
        ),
    );
    const gate = await pool.connect();
    let finished: Promise<PromiseSettledResult<unknown>[]> = Promise.resolve(
      [],
    );
    try {
      await gate.query('BEGIN');
      await gate.query(
        'SELECT id FROM reservations WHERE order_item_id = $1 FOR UPDATE',
        [req.items[1]!.orderItemId],
      );
      finished = Promise.allSettled([
        releaser!.release({ ...req, items: [] }),
        expirer!.expireReservations(),
      ]);
      await vi.waitFor(
        async () => {
          const { rows } = await pool.query(
            `SELECT application_name FROM pg_stat_activity
             WHERE application_name = ANY($1::text[]) AND wait_event_type = 'Lock'
               AND query ILIKE '%reservations%'`,
            [names],
          );
          expect(rows).toHaveLength(2);
        },
        { timeout: 5_000, interval: 10 },
      );
      // Neither worker may lock the later hold before the externally gated one.
      await gate.query(
        'SELECT id FROM reservations WHERE order_item_id = $1 FOR UPDATE NOWAIT',
        [req.items[0]!.orderItemId],
      );
      await gate.query('ROLLBACK');
      expect((await finished).map((result) => result.status)).toEqual([
        'fulfilled',
        'fulfilled',
      ]);
      expect(await stock.getStock(productId)).toMatchObject({
        inStock: 10,
        inReserved: 0,
        revision: 4,
      });
      expect(
        (
          await pool.query(
            "SELECT id FROM reservations WHERE status = 'active'",
          )
        ).rows,
      ).toEqual([]);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 2 });
    } finally {
      await gate.query('ROLLBACK');
      gate.release();
      await finished;
      await Promise.all(workers.map((worker) => worker.end()));
    }
  });

  it.each(['reserve', 'commit', 'release', 'expire'] as const)(
    'rolls back %s when its outbox write fails',
    async (operation) => {
      const req = request();
      if (operation !== 'reserve') await inventory.reserve(req);
      if (operation === 'expire')
        await pool.query(
          "UPDATE reservations SET expires_at = now() - interval '1 second'",
        );
      const before = await stock.getStock(productId);
      const holds = (await pool.query('SELECT * FROM reservations')).rows;
      await pool.query(
        `ALTER TABLE ${schema}_outbox.messages ADD CONSTRAINT fail_event CHECK (false) NOT VALID`,
      );
      try {
        const call =
          operation === 'expire'
            ? inventory.expireReservations()
            : operation === 'reserve'
              ? inventory.reserve(req)
              : inventory[operation]({ ...req, items: [] });
        await expect(call).rejects.toThrow();
        expect(await stock.getStock(productId)).toEqual(before);
        expect((await pool.query('SELECT * FROM reservations')).rows).toEqual(
          holds,
        );
        expect(
          (await pool.query('SELECT operation FROM reserve_idempotency')).rows,
        ).toEqual(operation === 'reserve' ? [] : [{ operation: 'reserve' }]);
      } finally {
        await pool.query(
          `ALTER TABLE ${schema}_outbox.messages DROP CONSTRAINT fail_event`,
        );
      }
    },
  );

  it('rolls back every product when one item cannot be allocated', async () => {
    const req = request();
    req.items.push({
      orderItemId: randomUUID(),
      // Sort after the stocked product, so failure rolls back an actual allocation.
      productId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      quantity: 1,
    });
    await expect(inventory.reserve(req)).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 10,
      inReserved: 0,
      revision: 1,
    });
    expect((await pool.query('SELECT * FROM reservations')).rows).toEqual([]);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
  });

  it('publishes the final product balance when multiple positions share stock', async () => {
    const req = request();
    req.items.push({ orderItemId: randomUUID(), productId, quantity: 2 });
    const accepted = await inventory.reserve(req);
    expect(accepted.reservations).toHaveLength(2);
    const events = await messages.claim({
      owner: 'test',
      now: Date.now(),
      leaseMs: 30_000,
      limit: 10,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      product_id: productId,
      in_stock: 10,
      in_reserved: 5,
      revision: 3,
    });
  });

  it('rolls back a partial commit when a deadline passes after validation', async () => {
    const req = request();
    const delayedItem = randomUUID();
    req.items.push({ orderItemId: delayedItem, productId, quantity: 2 });
    await inventory.reserve(req);
    const before = await stock.getStock(productId);
    const holds = (await pool.query('SELECT * FROM reservations ORDER BY id'))
      .rows;
    const finalize = repository.finalizeReservations.bind(repository);
    const crossingDeadline = vi
      .spyOn(repository, 'finalizeReservations')
      .mockImplementationOnce(async (tx, orderId, to) => {
        // Cross one deadline between application validation and authoritative SQL.
        await tx.execute(
          sql`UPDATE reservations SET expires_at = clock_timestamp() - interval '1 second' WHERE order_item_id = ${delayedItem}::uuid`,
        );
        return finalize(tx, orderId, to);
      });
    try {
      await expect(
        inventory.commit({ ...req, items: [] }),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        message: 'reservation expired during commit',
      });
    } finally {
      crossingDeadline.mockRestore();
    }
    expect(await stock.getStock(productId)).toEqual(before);
    expect(
      (await pool.query('SELECT * FROM reservations ORDER BY id')).rows,
    ).toEqual(holds);
    expect(
      (
        await pool.query(
          "SELECT * FROM reserve_idempotency WHERE operation = 'commit'",
        )
      ).rows,
    ).toEqual([]);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it.each(['set', 'adjust'] as const)(
    'rolls back %sStock when outbox persistence fails',
    async (operation) => {
      const before = await stock.getStock(productId);
      await pool.query(
        `ALTER TABLE ${schema}_outbox.messages ADD CONSTRAINT fail_event CHECK (false) NOT VALID`,
      );
      try {
        await expect(
          operation === 'set'
            ? stock.setStock(productId, 12, actor)
            : stock.adjustStock(productId, -2, actor),
        ).rejects.toThrow();
      } finally {
        await pool.query(
          `ALTER TABLE ${schema}_outbox.messages DROP CONSTRAINT fail_event`,
        );
      }
      expect(await stock.getStock(productId)).toEqual(before);
      expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
    },
  );

  it('translates a setStock constraint failure and preserves the reserved balance', async () => {
    await inventory.reserve(request(3));
    const before = await stock.getStock(productId);
    await expect(stock.setStock(productId, 2, actor)).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
    });
    expect(await stock.getStock(productId)).toEqual(before);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it('initializes existing stock using the same transaction without overwriting it', async () => {
    const before = await stock.getStock(productId);
    await stockRepository.transaction((tx) =>
      stock.initializeStock(productId, 99, tx),
    );
    expect(await stock.getStock(productId)).toEqual(before);
    const events = await messages.claim({
      owner: 'initialization-test',
      now: Date.now(),
      leaseMs: 1_000,
      limit: 10,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      product_id: productId,
      in_stock: 10,
      revision: before.revision,
    });
  });

  it('commits stock writes and events together without aggregate bookkeeping', async () => {
    const before = await stock.getStock(productId);
    await expect(
      stockRepository.transaction(async (tx) => {
        const [stock] = await stockRepository.incrementStock(tx, productId, 2);
        await stockRepository.recordStockChanges(tx, [stock!]);
        expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await stock.getStock(productId)).toEqual(before);
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 0 });
    await stockRepository.transaction(async (tx) => {
      const [stock] = await stockRepository.incrementStock(tx, productId, 2);
      await stockRepository.recordStockChanges(tx, [stock!]);
    });
    expect(await stock.getStock(productId)).toMatchObject({
      inStock: 12,
      revision: 2,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });

  it('commits inbox, initialization, and outbox together and deduplicates delivery', async () => {
    const id = randomUUID();
    const eventId = randomUUID();
    const deliver = () =>
      stockRepository.transaction(async (tx) =>
        inbox.processInTransaction(tx, 'inventory', eventId, () =>
          stock.initializeStock(id, 8, tx),
        ),
      );
    await pool.query(
      `ALTER TABLE ${schema}_outbox.messages ADD CONSTRAINT fail_event CHECK (false) NOT VALID`,
    );
    try {
      await expect(deliver()).rejects.toThrow();
      await expect(stock.getStock(id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await pool.query(
        `ALTER TABLE ${schema}_outbox.messages DROP CONSTRAINT fail_event`,
      );
    }
    await deliver();
    await deliver();
    expect(await stock.getStock(id)).toMatchObject({
      inStock: 8,
      revision: 1,
    });
    expect(await messages.stats(Date.now())).toMatchObject({ pending: 1 });
  });
});
