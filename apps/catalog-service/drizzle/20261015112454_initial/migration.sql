CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"parent_id" uuid,
	"slug" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_not_self_parent" CHECK ("parent_id" is null or "parent_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"product_id" uuid,
	"category_id" uuid,
	CONSTRAINT "product_categories_pkey" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"seller_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_minor" bigint NOT NULL,
	"image_url" text,
	"idempotency_key" text DEFAULT '' NOT NULL,
	"request_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_title_len" CHECK (length("title") between 1 and 200),
	CONSTRAINT "products_price_minor_nonneg" CHECK ("price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_projection" (
	"product_id" uuid PRIMARY KEY,
	"in_stock" integer DEFAULT 0 NOT NULL,
	"in_reserved" integer DEFAULT 0 NOT NULL,
	"revision" bigint NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug" ON "categories" ("slug");--> statement-breakpoint
CREATE INDEX "products_seller" ON "products" ("seller_id");--> statement-breakpoint
CREATE INDEX "products_deleted_at" ON "products" ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_seller_idempotency_key" ON "products" ("seller_id","idempotency_key") WHERE "idempotency_key" <> '';--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE;
