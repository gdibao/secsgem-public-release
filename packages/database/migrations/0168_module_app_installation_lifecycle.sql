ALTER TABLE "module_app_installations"
  ALTER COLUMN "version_id" DROP NOT NULL;
--> statement-breakpoint

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT "conname"
    FROM "pg_constraint"
    WHERE "contype" = 'f'
      AND "conrelid" = 'public.module_app_installations'::regclass
      AND "confrelid" = 'public.module_app_versions'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE "module_app_installations" DROP CONSTRAINT %I',
      constraint_row."conname"
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE "module_app_installations"
  ADD CONSTRAINT "module_app_installations_version_id_module_app_versions_id_fk"
  FOREIGN KEY ("version_id")
  REFERENCES "module_app_versions"("id")
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

UPDATE "module_app_installations"
SET
  "status" = 'uninstalled',
  "uninstalled_at" = COALESCE("uninstalled_at", NOW()),
  "version_id" = NULL
WHERE "status" = 'uninstalled' OR "uninstalled_at" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "module_app_installation_version_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "installation_id" uuid NOT NULL
    REFERENCES "module_app_installations"("id") ON DELETE cascade,
  "version_id" uuid NOT NULL
    REFERENCES "module_app_versions"("id") ON DELETE no action
    DEFERRABLE INITIALLY DEFERRED,
  "package_id" uuid
    REFERENCES "module_app_packages"("id") ON DELETE no action
    DEFERRABLE INITIALLY DEFERRED,
  "build_id" uuid
    REFERENCES "module_app_builds"("id") ON DELETE no action
    DEFERRABLE INITIALLY DEFERRED,
  "activation_count" integer DEFAULT 1 NOT NULL,
  "last_activated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "module_app_installation_version_refs_count_check"
    CHECK ("activation_count" >= 1)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "module_app_installation_version_refs_unique"
  ON "module_app_installation_version_refs" ("installation_id", "version_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "module_app_installation_version_refs_version_idx"
  ON "module_app_installation_version_refs" ("version_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "module_app_installation_version_refs_package_idx"
  ON "module_app_installation_version_refs" ("package_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "module_app_installation_version_refs_build_idx"
  ON "module_app_installation_version_refs" ("build_id");
--> statement-breakpoint

INSERT INTO "module_app_installation_version_refs" (
  "installation_id",
  "version_id",
  "package_id",
  "build_id"
)
SELECT
  "installation"."id",
  "installation"."version_id",
  COALESCE("build"."package_id", "package"."id"),
  "build"."id"
FROM "module_app_installations" AS "installation"
LEFT JOIN "module_app_builds" AS "build"
  ON "build"."version_id" = "installation"."version_id"
LEFT JOIN LATERAL (
  SELECT "id"
  FROM "module_app_packages"
  WHERE "version_id" = "installation"."version_id"
  ORDER BY "published_at" DESC NULLS LAST, "created_at" DESC, "id" DESC
  LIMIT 1
) AS "package" ON TRUE
WHERE
  "installation"."status" = 'installed'
  AND "installation"."uninstalled_at" IS NULL
  AND "installation"."version_id" IS NOT NULL
ON CONFLICT ("installation_id", "version_id") DO NOTHING;
--> statement-breakpoint

ALTER TABLE "module_app_installations"
  DROP CONSTRAINT IF EXISTS "module_app_installations_lifecycle_check";
--> statement-breakpoint

ALTER TABLE "module_app_installations"
  ADD CONSTRAINT "module_app_installations_lifecycle_check"
  CHECK (
    ("status" = 'installed' AND "version_id" IS NOT NULL AND "uninstalled_at" IS NULL)
    OR ("status" = 'uninstalled' AND "version_id" IS NULL AND "uninstalled_at" IS NOT NULL)
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_module_app_installation_version_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'installed'
    AND NEW."uninstalled_at" IS NULL
    AND NEW."version_id" IS NOT NULL
  THEN
    INSERT INTO "module_app_installation_version_refs" (
      "installation_id",
      "version_id",
      "package_id",
      "build_id"
    )
    SELECT
      NEW."id",
      NEW."version_id",
      COALESCE("build"."package_id", "package"."id"),
      "build"."id"
    FROM "module_app_versions" AS "version"
    LEFT JOIN "module_app_builds" AS "build"
      ON "build"."version_id" = "version"."id"
    LEFT JOIN LATERAL (
      SELECT "id"
      FROM "module_app_packages"
      WHERE "version_id" = "version"."id"
      ORDER BY "published_at" DESC NULLS LAST, "created_at" DESC, "id" DESC
      LIMIT 1
    ) AS "package" ON TRUE
    WHERE "version"."id" = NEW."version_id"
    ON CONFLICT ("installation_id", "version_id") DO UPDATE
    SET
      "package_id" = EXCLUDED."package_id",
      "build_id" = EXCLUDED."build_id",
      "activation_count" = "module_app_installation_version_refs"."activation_count" + 1,
      "last_activated_at" = NOW(),
      "updated_at" = NOW();
  ELSE
    DELETE FROM "module_app_installation_version_refs"
    WHERE "installation_id" = NEW."id";
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS sync_module_app_installation_version_refs_trigger
  ON "module_app_installations";
--> statement-breakpoint

CREATE TRIGGER sync_module_app_installation_version_refs_trigger
AFTER INSERT OR UPDATE OF "version_id", "status", "uninstalled_at"
ON "module_app_installations"
FOR EACH ROW
EXECUTE FUNCTION sync_module_app_installation_version_refs();
