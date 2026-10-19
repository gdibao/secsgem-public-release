CREATE TABLE IF NOT EXISTS "admin_newapi_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 0,
  "description" text,
  "fetch_on_client" boolean NOT NULL DEFAULT false,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_newapi_instances_enabled_priority_idx"
  ON "admin_newapi_instances" ("enabled", "priority");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_newapi_instance_models" (
  "instance_id" uuid NOT NULL REFERENCES "admin_newapi_instances"("id") ON DELETE CASCADE,
  "model_id" varchar(128) NOT NULL,
  "model_type" varchar(20) NOT NULL,
  "display_name" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_newapi_instance_models_pkey"
    PRIMARY KEY ("instance_id", "model_id", "model_type")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_newapi_instance_models_type_idx"
  ON "admin_newapi_instance_models" ("model_type", "enabled");
--> statement-breakpoint

ALTER TABLE "plan_catalog" ADD COLUMN IF NOT EXISTS "model_rules" jsonb;
--> statement-breakpoint

-- One-shot migration of legacy single-instance NewAPI app_settings into the
-- new admin_newapi_instances table. Runs only when no instance exists yet
-- (idempotent against re-runs) and at least a baseUrl is configured.
DO $$
DECLARE
  v_api_key text;
  v_proxy_url text;
  v_models jsonb;
  v_new_id uuid;
  v_model text;
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM "admin_newapi_instances";
  IF v_count > 0 THEN
    RETURN;
  END IF;

  SELECT value::text INTO v_api_key FROM "app_settings" WHERE key = 'newapi.apiKey';
  SELECT value::text INTO v_proxy_url FROM "app_settings" WHERE key = 'newapi.proxyUrl';
  SELECT value INTO v_models FROM "app_settings" WHERE key = 'newapi.enabledModels';

  -- value column is jsonb; strings come back as quoted JSON like "abc". Strip outer quotes.
  v_api_key := NULLIF(trim(both '"' from coalesce(v_api_key, '')), '');
  v_proxy_url := NULLIF(trim(both '"' from coalesce(v_proxy_url, '')), '');

  IF v_proxy_url IS NULL OR v_api_key IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "admin_newapi_instances" (name, base_url, api_key, enabled, priority, description)
  VALUES ('Default (migrated)', v_proxy_url, v_api_key, true, 0,
          'Auto-migrated from legacy newapi.* app_settings on 0112 migration')
  RETURNING id INTO v_new_id;

  -- Migrate enabled chat models. Legacy storage was either a separator-delimited
  -- string (using comma, newline, semicolon, fullwidth comma/semicolon) or a
  -- JSON string array; both are normalized here using the same delimiter set as
  -- src/business/server/lambda-routers/admin/settings.ts -> toStringList.
  IF v_models IS NOT NULL THEN
    IF jsonb_typeof(v_models) = 'string' THEN
      FOR v_model IN
        SELECT trim(unnest(regexp_split_to_array(v_models #>> '{}', E'[\r\n,;；，]+')))
      LOOP
        IF v_model <> '' THEN
          INSERT INTO "admin_newapi_instance_models"
            (instance_id, model_id, model_type, enabled)
          VALUES (v_new_id, v_model, 'chat', true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    ELSIF jsonb_typeof(v_models) = 'array' THEN
      FOR v_model IN
        SELECT jsonb_array_elements_text(v_models)
      LOOP
        IF trim(v_model) <> '' THEN
          INSERT INTO "admin_newapi_instance_models"
            (instance_id, model_id, model_type, enabled)
          VALUES (v_new_id, trim(v_model), 'chat', true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END IF;
END
$$;
