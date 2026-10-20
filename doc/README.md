# system flows

[Документация на русском](README.ru.md) ·
[Project overview](../README.md) · [Editable diagrams](diagrams.excalidraw)

Open `diagrams.excalidraw` in Excalidraw to edit the diagrams below and the
component diagram in the project README.

## authorization

Users verifies credentials with Argon2 and issues access and refresh tokens.
The gateway checks access tokens and roles, then forwards user identity as
gRPC metadata. Domain services enforce ownership; internal gRPC endpoints
must remain private.

![Login and authenticated request sequence](authorization-diagram.png)

## create product

Catalog saves the product and its `product.created` outbox event in one
transaction. The response does not wait for Inventory to initialize stock.

![Product creation across Catalog, Kafka, and Inventory](create-product.png)

Inventory consumes the event, initializes stock, and publishes `stock.initialized`.
Catalog then updates its stock read model. Inbox records deduplicate event-driven
writes; the product may be visible before its stock view catches up.

![Product creation, outbox publication, and stock projection sequence](create-product-sequence.png)

## checkout saga

### acceptance

The cart is a `DRAFT` order. Orders fetches prices from Catalog, then locks the
cart and checks that its contents have not changed during pricing. One transaction
saves item snapshots, `PENDING_PAYMENT`, the checkout outbox event, and the
idempotent response. The client gets checkout acceptance, not payment confirmation.

![Checkout validation and atomic acceptance](saga-checkout.png)

The sketch shows `202 Accepted`; the current HTTP handler returns NestJS's default `201`.

### processing

The outbox relay publishes the checkout event; its Kafka consumer starts the saga.
Orders coordinates the remaining steps over gRPC:
reserve stock → create and capture payment → save `PAID` → commit stock → `CONFIRMED`.

Capture intent is saved before requesting capture. It records the intent to charge,
not a successful payment. Stable idempotency keys allow retries after a lost response.

![Stock reservation, payment capture, and order confirmation sequence](saga-sequence.png)

### recovery

Recovery runs at startup and every five seconds, skipping orders already being
processed. It reloads persisted state to continue payment, retry stock commit,
or finish compensation. Temporary failures leave the work retryable; business
failures and timeouts trigger stock release and payment reconciliation/refund.

![Recovery dispatch by order state and pending compensation](saga-recovery.png)

The final success status is `CONFIRMED` (`COMPLETED` in the sketch). `FAILED`
and `CANCELED` require no further work only after pending compensation is settled.

Payment uses a mock provider. Saga coordination is process-local; multiple Orders
replicas would need distributed coordination.
