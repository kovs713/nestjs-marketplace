CREATE TYPE "user_role" AS ENUM('buyer', 'seller');--> statement-breakpoint
CREATE TYPE "user_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TABLE "user_credentials_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"login" varchar(20) NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'buyer'::"user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active'::"user_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_active" ON "users" ("login") WHERE ("deleted_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active" ON "users" ("email") WHERE ("deleted_at" is null);--> statement-breakpoint
ALTER TABLE "user_credentials_refresh_tokens" ADD CONSTRAINT "user_credentials_refresh_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;