CREATE TYPE "reservation_status" AS ENUM('active', 'committed', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "reservation_orders" (
	"order_id" uuid PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'active'::"reservation_status" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "reserve_idempotency" (
	"operation" text DEFAULT 'reserve',
	"key" text,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	CONSTRAINT "reserve_idempotency_pkey" PRIMARY KEY("operation","key")
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"product_id" uuid PRIMARY KEY,
	"in_stock" integer DEFAULT 0 NOT NULL,
	"in_reserved" integer DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocks_in_stock_nonneg" CHECK ("in_stock" >= 0),
	CONSTRAINT "stocks_in_reserved_nonneg" CHECK ("in_reserved" >= 0),
	CONSTRAINT "stocks_reserved_lte_stock" CHECK ("in_reserved" <= "in_stock"),
	CONSTRAINT "stocks_revision_safe" CHECK ("revision" >= 0 and "revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_order_item" ON "reservations" ("order_id","order_item_id");--> statement-breakpoint
CREATE INDEX "reservations_product_status" ON "reservations" ("product_id","status");--> statement-breakpoint
CREATE INDEX "reservations_expiry_active" ON "reservations" ("expires_at") WHERE "status" = 'active';
