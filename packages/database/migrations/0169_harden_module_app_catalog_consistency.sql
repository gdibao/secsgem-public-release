DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "module_app_versions"
    WHERE "published_at" IS NULL
    GROUP BY "app_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'module_app_versions contains multiple drafts for an application';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "module_app_versions"
    WHERE "published_at" IS NOT NULL
    GROUP BY "app_id", "version"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'module_app_versions contains duplicate published version numbers';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "module_app_pages"
    GROUP BY "version_id", "page_key"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'module_app_pages contains duplicate page keys within a version';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "module_app_actions"
    GROUP BY "version_id", "action_key"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'module_app_actions contains duplicate action keys within a version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "module_app_pages" AS page
    JOIN "module_app_versions" AS version ON version."id" = page."version_id"
    WHERE version."app_id" <> page."app_id"
  ) OR EXISTS (
    SELECT 1
    FROM "module_app_actions" AS action
    JOIN "module_app_versions" AS version ON version."id" = action."version_id"
    WHERE version."app_id" <> action."app_id"
  ) THEN
    RAISE EXCEPTION 'module app page or action references a version owned by another application';
  END IF;
END $$;
--> statement-breakpoint

DROP INDEX IF EXISTS "module_app_versions_app_id_version_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_versions_id_app_id_unique"
  ON "module_app_versions" ("id", "app_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_versions_app_id_published_version_unique"
  ON "module_app_versions" ("app_id", "version")
  WHERE "published_at" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_versions_one_draft_per_app_unique"
  ON "module_app_versions" ("app_id")
  WHERE "published_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_pages_version_id_page_key_unique"
  ON "module_app_pages" ("version_id", "page_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_app_actions_version_id_action_key_unique"
  ON "module_app_actions" ("version_id", "action_key");
--> statement-breakpoint

ALTER TABLE "module_app_pages"
  DROP CONSTRAINT IF EXISTS "module_app_pages_version_id_module_app_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "module_app_actions"
  DROP CONSTRAINT IF EXISTS "module_app_actions_version_id_module_app_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "module_app_pages"
  ADD CONSTRAINT "module_app_pages_version_app_fk"
  FOREIGN KEY ("version_id", "app_id")
  REFERENCES "module_app_versions" ("id", "app_id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "module_app_actions"
  ADD CONSTRAINT "module_app_actions_version_app_fk"
  FOREIGN KEY ("version_id", "app_id")
  REFERENCES "module_app_versions" ("id", "app_id")
  ON DELETE CASCADE;
