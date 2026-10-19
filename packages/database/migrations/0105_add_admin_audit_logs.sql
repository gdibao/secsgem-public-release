CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "target_user_id" text,
  "action" varchar(64) NOT NULL,
  "resource_type" varchar(64),
  "resource_id" text,
  "payload" jsonb,
  "ip_address" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_actor_idx" ON "admin_audit_logs" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_idx" ON "admin_audit_logs" ("target_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_idx" ON "admin_audit_logs" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs" ("created_at");
