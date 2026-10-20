CREATE TYPE "order_status" AS ENUM('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'CANCELED', 'FAILED');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"price_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "order_items_price_nonneg" CHECK ("price_minor" is null or "price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checkout_idempotency" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'DRAFT'::"order_status" NOT NULL,
	"total_minor" bigint,
	"failure_reason" text,
	"payment_timeout_at" timestamp with time zone,
	"capture_intent_recorded" boolean DEFAULT false NOT NULL,
	"compensation_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovery_attempted_at" timestamp with time zone,
	CONSTRAINT "orders_total_minor_nonneg" CHECK ("total_minor" is null or "total_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_product" ON "order_items" ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_idempotency_user_key" ON "checkout_idempotency" ("user_id","key");--> statement-breakpoint
CREATE INDEX "orders_user_status" ON "orders" ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_draft" ON "orders" ("user_id") WHERE "status" = 'DRAFT';--> statement-breakpoint
CREATE INDEX "orders_pending_payment" ON "orders" ("status") WHERE "status" = 'PENDING_PAYMENT';--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
