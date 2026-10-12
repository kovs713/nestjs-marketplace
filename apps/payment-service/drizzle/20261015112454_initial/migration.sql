CREATE TYPE "payment_method" AS ENUM('CARD', 'SBP', 'WALLET');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payment_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"payment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "payment_status" NOT NULL,
	"provider_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_history_sequence_positive" CHECK ("sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING'::"payment_status" NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"provider_ref" text,
	"refund_provider_ref" text,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_minor_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_history_payment_sequence" ON "payment_history" ("payment_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_idempotency_operation_key" ON "payment_idempotency" ("operation","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_id" ON "payments" ("order_id");--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;
