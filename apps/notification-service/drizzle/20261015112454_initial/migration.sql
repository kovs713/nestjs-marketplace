CREATE TYPE "notification_type" AS ENUM('ORDER_STATUS', 'PAYMENT', 'STOCK');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"source_event_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" varchar(2000) NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_event_id" ON "notifications" ("source_event_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" ("user_id","id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "notifications" ("user_id","id") WHERE "read_at" is null;