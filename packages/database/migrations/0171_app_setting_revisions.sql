CREATE TABLE IF NOT EXISTS "app_setting_revisions" (
  "section" varchar(64) PRIMARY KEY NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "app_setting_revisions_nonnegative_check" CHECK ("revision" >= 0)
);
