-- Repair migrations that were appended after the legacy journal cutoff.
-- Each source runs only when its historical Drizzle record is absent.
-- This preserves already-applied migrations while repairing installations
-- where the timestamp merge caused the source migration to be skipped.

-- Source: 0127_add_topic_comments.sql
-- Historical created_at: 1784716592911
DO $comhub_guard_0127_add_topic_comments$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1784716592911
  ) THEN
    EXECUTE $comhub_sql_0127_add_topic_comments_0$
-- Topic Comments had one shared pre-release draft before this migration was
-- finalized. Accept only that exact draft (or the exact final shape on a safe
-- re-run); an unrelated or partially-created table must fail before any DDL
-- mutates it.
DO $$
DECLARE
	comments_exist boolean := to_regclass('public.topic_comments') IS NOT NULL;
	mentions_exist boolean := to_regclass('public.topic_comment_mentions') IS NOT NULL;
	comments_are_draft boolean := false;
	comments_are_final boolean := false;
	mentions_are_expected boolean := false;
	shape_details text;
BEGIN
	IF comments_exist IS DISTINCT FROM mentions_exist THEN
		RAISE EXCEPTION
			'Topic Comment migration found a partial pre-existing schema (topic_comments=%, topic_comment_mentions=%). Refusing to mutate an unknown shape.',
			comments_exist,
			mentions_exist;
	END IF;

	-- Neither table exists: this is the normal fresh-database path.
	IF NOT comments_exist THEN
		RETURN;
	END IF;

	IF (SELECT relkind FROM pg_class WHERE oid = 'public.topic_comments'::regclass) <> 'r'
		OR (SELECT relkind FROM pg_class WHERE oid = 'public.topic_comment_mentions'::regclass) <> 'r' THEN
		RAISE EXCEPTION 'Topic Comment migration requires ordinary public tables; refusing to mutate an unknown relation kind.';
	END IF;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'text', true, NULL::text),
			('topic_id', 'text', true, NULL::text),
			('message_id', 'text', false, NULL::text),
			('parent_comment_id', 'text', false, NULL::text),
			('author_user_id', 'text', false, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('content', 'text', true, NULL::text),
			('editor_data', 'jsonb', false, NULL::text),
			('client_id', 'text', true, NULL::text),
			('anchor_preview', 'jsonb', false, NULL::text),
			('deleted_at', 'timestamp with time zone', false, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()'),
			('updated_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO comments_are_draft;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'text', true, NULL::text),
			('topic_id', 'text', true, NULL::text),
			('message_id', 'text', false, NULL::text),
			('parent_comment_id', 'text', false, NULL::text),
			('author_user_id', 'text', false, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('content', 'text', true, NULL::text),
			('editor_data', 'jsonb', false, NULL::text),
			('client_id', 'text', true, NULL::text),
			('anchor_preview', 'jsonb', false, NULL::text),
			('deleted_at', 'timestamp with time zone', false, NULL::text),
			('moderated_at', 'timestamp with time zone', false, NULL::text),
			('moderated_by_user_id', 'text', false, NULL::text),
			('moderation_expires_at', 'timestamp with time zone', false, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()'),
			('updated_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO comments_are_final;

	IF NOT comments_are_draft AND NOT comments_are_final THEN
		SELECT string_agg(
			format(
				'%I %s%s default=%s',
				a.attname,
				format_type(a.atttypid, a.atttypmod),
				CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
				coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>')
			),
			', ' ORDER BY a.attnum
		)
		INTO shape_details
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped;

		RAISE EXCEPTION
			'Topic Comment migration found an unsupported topic_comments column shape: %',
			shape_details;
	END IF;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comment_mentions'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'uuid', true, 'gen_random_uuid()'),
			('comment_id', 'text', true, NULL::text),
			('mentioned_user_id', 'text', true, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO mentions_are_expected;

	IF NOT mentions_are_expected THEN
		SELECT string_agg(
			format(
				'%I %s%s default=%s',
				a.attname,
				format_type(a.atttypid, a.atttypmod),
				CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
				coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>')
			),
			', ' ORDER BY a.attnum
		)
		INTO shape_details
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comment_mentions'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped;

		RAISE EXCEPTION
			'Topic Comment migration found an unsupported topic_comment_mentions column shape: %',
			shape_details;
	END IF;

	-- Constraint and index names must match one complete known shape. Their
	-- definitions are recreated below, so a same-name draft definition is safe;
	-- unknown extra/missing objects are not.
	WITH actual(name) AS (
		SELECT conname::text
		FROM pg_constraint
		WHERE conrelid = 'public.topic_comments'::regclass
	), expected(name) AS (
		SELECT * FROM (
			VALUES
				('topic_comments_pkey'),
				('topic_comments_anchored_requires_preview'),
				('topic_comments_reply_has_no_anchor'),
				('topic_comments_topic_id_topics_id_fk'),
				('topic_comments_message_id_messages_id_fk'),
				('topic_comments_parent_comment_id_topic_comments_id_fk'),
				('topic_comments_author_user_id_users_id_fk'),
				('topic_comments_workspace_id_workspaces_id_fk'),
				('topic_comments_moderation_window_consistent'),
				('topic_comments_deleted_not_recoverable'),
				('topic_comments_moderated_by_user_id_users_id_fk')
		) AS names(name)
		WHERE comments_are_final
			OR name NOT IN (
				'topic_comments_moderation_window_consistent',
				'topic_comments_deleted_not_recoverable',
				'topic_comments_moderated_by_user_id_users_id_fk'
			)
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comments constraints (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT index_class.relname::text
		FROM pg_index index_info
		JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
		WHERE index_info.indrelid = 'public.topic_comments'::regclass
	), expected(name) AS (
		SELECT * FROM (
			VALUES
				('topic_comments_pkey'),
				('topic_comments_topic_id_author_user_id_client_id_unique'),
				('topic_comments_parent_comment_id_created_at_id_idx'),
				('topic_comments_topic_id_created_at_id_idx'),
				('topic_comments_topic_id_message_id_idx'),
				('topic_comments_message_id_idx'),
				('topic_comments_author_user_id_idx'),
				('topic_comments_workspace_id_idx'),
				('topic_comments_moderation_expires_at_idx'),
				('topic_comments_moderated_by_user_id_idx')
		) AS names(name)
		WHERE comments_are_final
			OR name NOT IN (
				'topic_comments_moderation_expires_at_idx',
				'topic_comments_moderated_by_user_id_idx'
			)
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comments indexes (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT conname::text
		FROM pg_constraint
		WHERE conrelid = 'public.topic_comment_mentions'::regclass
	), expected(name) AS (
		VALUES
			('topic_comment_mentions_pkey'),
			('topic_comment_mentions_comment_id_topic_comments_id_fk'),
			('topic_comment_mentions_mentioned_user_id_users_id_fk'),
			('topic_comment_mentions_workspace_id_workspaces_id_fk')
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comment_mentions constraints (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT index_class.relname::text
		FROM pg_index index_info
		JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
		WHERE index_info.indrelid = 'public.topic_comment_mentions'::regclass
	), expected(name) AS (
		VALUES
			('topic_comment_mentions_pkey'),
			('topic_comment_mentions_comment_id_mentioned_user_id_unique'),
			('topic_comment_mentions_mentioned_user_id_created_at_idx'),
			('topic_comment_mentions_workspace_id_idx')
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comment_mentions indexes (unexpected or missing: %).',
			shape_details;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint constraint_info
		WHERE constraint_info.conrelid = 'public.topic_comments'::regclass
			AND constraint_info.contype = 'p'
			AND constraint_info.conkey = ARRAY[
				(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.topic_comments'::regclass AND attname = 'id')
			]::smallint[]
	) OR NOT EXISTS (
		SELECT 1
		FROM pg_constraint constraint_info
		WHERE constraint_info.conrelid = 'public.topic_comment_mentions'::regclass
			AND constraint_info.contype = 'p'
			AND constraint_info.conkey = ARRAY[
				(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.topic_comment_mentions'::regclass AND attname = 'id')
			]::smallint[]
	) THEN
		RAISE EXCEPTION 'Topic Comment migration found an unsupported primary key definition.';
	END IF;
END
$$;
$comhub_sql_0127_add_topic_comments_0$;
    EXECUTE $comhub_sql_0127_add_topic_comments_1$
CREATE TABLE IF NOT EXISTS "topic_comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" text NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0127_add_topic_comments_1$;
    EXECUTE $comhub_sql_0127_add_topic_comments_2$
CREATE TABLE IF NOT EXISTS "topic_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"message_id" text,
	"parent_comment_id" text,
	"author_user_id" text,
	"workspace_id" text NOT NULL,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"client_id" text NOT NULL,
	"anchor_preview" jsonb,
	"deleted_at" timestamp with time zone,
	"moderated_at" timestamp with time zone,
	"moderated_by_user_id" text,
	"moderation_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_comments_anchored_requires_preview" CHECK ("topic_comments"."message_id" IS NULL OR "topic_comments"."anchor_preview" IS NOT NULL),
	CONSTRAINT "topic_comments_reply_has_no_anchor" CHECK ("topic_comments"."parent_comment_id" IS NULL OR ("topic_comments"."message_id" IS NULL AND "topic_comments"."anchor_preview" IS NULL)),
	CONSTRAINT "topic_comments_moderation_window_consistent" CHECK (("topic_comments"."moderated_at" IS NULL) = ("topic_comments"."moderation_expires_at" IS NULL)),
	CONSTRAINT "topic_comments_deleted_not_recoverable" CHECK ("topic_comments"."deleted_at" IS NULL OR "topic_comments"."moderated_at" IS NULL)
);
$comhub_sql_0127_add_topic_comments_2$;
    EXECUTE $comhub_sql_0127_add_topic_comments_3$
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp with time zone;
$comhub_sql_0127_add_topic_comments_3$;
    EXECUTE $comhub_sql_0127_add_topic_comments_4$
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderated_by_user_id" text;
$comhub_sql_0127_add_topic_comments_4$;
    EXECUTE $comhub_sql_0127_add_topic_comments_5$
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderation_expires_at" timestamp with time zone;
$comhub_sql_0127_add_topic_comments_5$;
    EXECUTE $comhub_sql_0127_add_topic_comments_6$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_anchored_requires_preview";
$comhub_sql_0127_add_topic_comments_6$;
    EXECUTE $comhub_sql_0127_add_topic_comments_7$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_anchored_requires_preview" CHECK ("message_id" IS NULL OR "anchor_preview" IS NOT NULL);
$comhub_sql_0127_add_topic_comments_7$;
    EXECUTE $comhub_sql_0127_add_topic_comments_8$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_reply_has_no_anchor";
$comhub_sql_0127_add_topic_comments_8$;
    EXECUTE $comhub_sql_0127_add_topic_comments_9$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_reply_has_no_anchor" CHECK ("parent_comment_id" IS NULL OR ("message_id" IS NULL AND "anchor_preview" IS NULL));
$comhub_sql_0127_add_topic_comments_9$;
    EXECUTE $comhub_sql_0127_add_topic_comments_10$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_moderation_window_consistent";
$comhub_sql_0127_add_topic_comments_10$;
    EXECUTE $comhub_sql_0127_add_topic_comments_11$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_moderation_window_consistent" CHECK (("moderated_at" IS NULL) = ("moderation_expires_at" IS NULL));
$comhub_sql_0127_add_topic_comments_11$;
    EXECUTE $comhub_sql_0127_add_topic_comments_12$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_deleted_not_recoverable";
$comhub_sql_0127_add_topic_comments_12$;
    EXECUTE $comhub_sql_0127_add_topic_comments_13$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_deleted_not_recoverable" CHECK ("deleted_at" IS NULL OR "moderated_at" IS NULL);
$comhub_sql_0127_add_topic_comments_13$;
    EXECUTE $comhub_sql_0127_add_topic_comments_14$
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_comment_id_topic_comments_id_fk";
$comhub_sql_0127_add_topic_comments_14$;
    EXECUTE $comhub_sql_0127_add_topic_comments_15$
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_comment_id_topic_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."topic_comments"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_15$;
    EXECUTE $comhub_sql_0127_add_topic_comments_16$
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_mentioned_user_id_users_id_fk";
$comhub_sql_0127_add_topic_comments_16$;
    EXECUTE $comhub_sql_0127_add_topic_comments_17$
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_17$;
    EXECUTE $comhub_sql_0127_add_topic_comments_18$
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_workspace_id_workspaces_id_fk";
$comhub_sql_0127_add_topic_comments_18$;
    EXECUTE $comhub_sql_0127_add_topic_comments_19$
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_19$;
    EXECUTE $comhub_sql_0127_add_topic_comments_20$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_topic_id_topics_id_fk";
$comhub_sql_0127_add_topic_comments_20$;
    EXECUTE $comhub_sql_0127_add_topic_comments_21$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_21$;
    EXECUTE $comhub_sql_0127_add_topic_comments_22$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_message_id_messages_id_fk";
$comhub_sql_0127_add_topic_comments_22$;
    EXECUTE $comhub_sql_0127_add_topic_comments_23$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_23$;
    EXECUTE $comhub_sql_0127_add_topic_comments_24$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_parent_comment_id_topic_comments_id_fk";
$comhub_sql_0127_add_topic_comments_24$;
    EXECUTE $comhub_sql_0127_add_topic_comments_25$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_parent_comment_id_topic_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."topic_comments"("id") ON DELETE no action ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_25$;
    EXECUTE $comhub_sql_0127_add_topic_comments_26$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_author_user_id_users_id_fk";
$comhub_sql_0127_add_topic_comments_26$;
    EXECUTE $comhub_sql_0127_add_topic_comments_27$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_27$;
    EXECUTE $comhub_sql_0127_add_topic_comments_28$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_workspace_id_workspaces_id_fk";
$comhub_sql_0127_add_topic_comments_28$;
    EXECUTE $comhub_sql_0127_add_topic_comments_29$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_29$;
    EXECUTE $comhub_sql_0127_add_topic_comments_30$
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_moderated_by_user_id_users_id_fk";
$comhub_sql_0127_add_topic_comments_30$;
    EXECUTE $comhub_sql_0127_add_topic_comments_31$
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0127_add_topic_comments_31$;
    EXECUTE $comhub_sql_0127_add_topic_comments_32$
DROP INDEX IF EXISTS "topic_comment_mentions_comment_id_mentioned_user_id_unique";
$comhub_sql_0127_add_topic_comments_32$;
    EXECUTE $comhub_sql_0127_add_topic_comments_33$
DROP INDEX IF EXISTS "topic_comment_mentions_mentioned_user_id_created_at_idx";
$comhub_sql_0127_add_topic_comments_33$;
    EXECUTE $comhub_sql_0127_add_topic_comments_34$
DROP INDEX IF EXISTS "topic_comment_mentions_workspace_id_idx";
$comhub_sql_0127_add_topic_comments_34$;
    EXECUTE $comhub_sql_0127_add_topic_comments_35$
DROP INDEX IF EXISTS "topic_comments_topic_id_author_user_id_client_id_unique";
$comhub_sql_0127_add_topic_comments_35$;
    EXECUTE $comhub_sql_0127_add_topic_comments_36$
DROP INDEX IF EXISTS "topic_comments_parent_comment_id_created_at_id_idx";
$comhub_sql_0127_add_topic_comments_36$;
    EXECUTE $comhub_sql_0127_add_topic_comments_37$
DROP INDEX IF EXISTS "topic_comments_topic_id_created_at_id_idx";
$comhub_sql_0127_add_topic_comments_37$;
    EXECUTE $comhub_sql_0127_add_topic_comments_38$
DROP INDEX IF EXISTS "topic_comments_topic_id_message_id_idx";
$comhub_sql_0127_add_topic_comments_38$;
    EXECUTE $comhub_sql_0127_add_topic_comments_39$
DROP INDEX IF EXISTS "topic_comments_message_id_idx";
$comhub_sql_0127_add_topic_comments_39$;
    EXECUTE $comhub_sql_0127_add_topic_comments_40$
DROP INDEX IF EXISTS "topic_comments_author_user_id_idx";
$comhub_sql_0127_add_topic_comments_40$;
    EXECUTE $comhub_sql_0127_add_topic_comments_41$
DROP INDEX IF EXISTS "topic_comments_moderation_expires_at_idx";
$comhub_sql_0127_add_topic_comments_41$;
    EXECUTE $comhub_sql_0127_add_topic_comments_42$
DROP INDEX IF EXISTS "topic_comments_moderated_by_user_id_idx";
$comhub_sql_0127_add_topic_comments_42$;
    EXECUTE $comhub_sql_0127_add_topic_comments_43$
DROP INDEX IF EXISTS "topic_comments_workspace_id_idx";
$comhub_sql_0127_add_topic_comments_43$;
    EXECUTE $comhub_sql_0127_add_topic_comments_44$
CREATE UNIQUE INDEX IF NOT EXISTS "topic_comment_mentions_comment_id_mentioned_user_id_unique" ON "topic_comment_mentions" USING btree ("comment_id","mentioned_user_id");
$comhub_sql_0127_add_topic_comments_44$;
    EXECUTE $comhub_sql_0127_add_topic_comments_45$
CREATE INDEX IF NOT EXISTS "topic_comment_mentions_mentioned_user_id_created_at_idx" ON "topic_comment_mentions" USING btree ("mentioned_user_id","created_at");
$comhub_sql_0127_add_topic_comments_45$;
    EXECUTE $comhub_sql_0127_add_topic_comments_46$
CREATE INDEX IF NOT EXISTS "topic_comment_mentions_workspace_id_idx" ON "topic_comment_mentions" USING btree ("workspace_id");
$comhub_sql_0127_add_topic_comments_46$;
    EXECUTE $comhub_sql_0127_add_topic_comments_47$
CREATE UNIQUE INDEX IF NOT EXISTS "topic_comments_topic_id_author_user_id_client_id_unique" ON "topic_comments" USING btree ("topic_id","author_user_id","client_id");
$comhub_sql_0127_add_topic_comments_47$;
    EXECUTE $comhub_sql_0127_add_topic_comments_48$
CREATE INDEX IF NOT EXISTS "topic_comments_parent_comment_id_created_at_id_idx" ON "topic_comments" USING btree ("parent_comment_id","created_at","id");
$comhub_sql_0127_add_topic_comments_48$;
    EXECUTE $comhub_sql_0127_add_topic_comments_49$
CREATE INDEX IF NOT EXISTS "topic_comments_topic_id_created_at_id_idx" ON "topic_comments" USING btree ("topic_id","created_at","id");
$comhub_sql_0127_add_topic_comments_49$;
    EXECUTE $comhub_sql_0127_add_topic_comments_50$
CREATE INDEX IF NOT EXISTS "topic_comments_topic_id_message_id_idx" ON "topic_comments" USING btree ("topic_id","message_id");
$comhub_sql_0127_add_topic_comments_50$;
    EXECUTE $comhub_sql_0127_add_topic_comments_51$
CREATE INDEX IF NOT EXISTS "topic_comments_message_id_idx" ON "topic_comments" USING btree ("message_id");
$comhub_sql_0127_add_topic_comments_51$;
    EXECUTE $comhub_sql_0127_add_topic_comments_52$
CREATE INDEX IF NOT EXISTS "topic_comments_author_user_id_idx" ON "topic_comments" USING btree ("author_user_id");
$comhub_sql_0127_add_topic_comments_52$;
    EXECUTE $comhub_sql_0127_add_topic_comments_53$
CREATE INDEX IF NOT EXISTS "topic_comments_moderation_expires_at_idx" ON "topic_comments" USING btree ("moderation_expires_at");
$comhub_sql_0127_add_topic_comments_53$;
    EXECUTE $comhub_sql_0127_add_topic_comments_54$
CREATE INDEX IF NOT EXISTS "topic_comments_moderated_by_user_id_idx" ON "topic_comments" USING btree ("moderated_by_user_id");
$comhub_sql_0127_add_topic_comments_54$;
    EXECUTE $comhub_sql_0127_add_topic_comments_55$
CREATE INDEX IF NOT EXISTS "topic_comments_workspace_id_idx" ON "topic_comments" USING btree ("workspace_id");
$comhub_sql_0127_add_topic_comments_55$;
    EXECUTE $comhub_sql_0127_add_topic_comments_56$
-- Persist the Topic Comment permission rows before linking existing roles. IDs
-- are deterministic 16-character text values, matching the RBAC table's normal
-- application-generated ID width while keeping this backfill idempotent.
INSERT INTO "rbac_permissions" ("id", "code", "name", "category")
SELECT
	substring(md5('topic-comment-rbac:' || permission.code) from 1 for 16),
	permission.code,
	permission.name,
	'topic_comment'
FROM (
	VALUES
		('topic_comment:read:all', 'Topic Comment Read'),
		('topic_comment:create:all', 'Topic Comment Create'),
		('topic_comment:update:all', 'Topic Comment Update'),
		('topic_comment:delete:all', 'Topic Comment Delete'),
		('topic_comment:restore:all', 'Topic Comment Restore'),
		('topic_comment:create:owner', 'Topic Comment Create'),
		('topic_comment:update:owner', 'Topic Comment Update'),
		('topic_comment:delete:owner', 'Topic Comment Delete')
) AS permission(code, name)
ON CONFLICT ("code") DO NOTHING;
$comhub_sql_0127_add_topic_comments_56$;
    EXECUTE $comhub_sql_0127_add_topic_comments_57$
-- Backfill only the three workspace system roles plus the globally reserved
-- super_admin role. Legacy rows may predate the is_system flag, so its reserved
-- name + NULL workspace scope identify it. Workspace custom roles deliberately
-- retain their administrator-selected permission set.
INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT role.id, permission.id
FROM (
	VALUES
		('workspace_owner', true, 'topic_comment:read:all'),
		('workspace_owner', true, 'topic_comment:create:all'),
		('workspace_owner', true, 'topic_comment:update:all'),
		('workspace_owner', true, 'topic_comment:delete:all'),
		('workspace_owner', true, 'topic_comment:restore:all'),
		('workspace_member', true, 'topic_comment:read:all'),
		('workspace_member', true, 'topic_comment:create:owner'),
		('workspace_member', true, 'topic_comment:update:owner'),
		('workspace_member', true, 'topic_comment:delete:owner'),
		('workspace_viewer', true, 'topic_comment:read:all'),
		('super_admin', false, 'topic_comment:read:all'),
		('super_admin', false, 'topic_comment:create:all'),
		('super_admin', false, 'topic_comment:update:all'),
		('super_admin', false, 'topic_comment:delete:all'),
		('super_admin', false, 'topic_comment:restore:all')
) AS grant_spec(role_name, workspace_scoped, permission_code)
JOIN "rbac_roles" role
	ON role.name = grant_spec.role_name
	AND (
		(grant_spec.workspace_scoped AND role.is_system = true AND role.workspace_id IS NOT NULL)
		OR (NOT grant_spec.workspace_scoped AND role.workspace_id IS NULL)
	)
JOIN "rbac_permissions" permission ON permission.code = grant_spec.permission_code
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
$comhub_sql_0127_add_topic_comments_57$;
  END IF;
END
$comhub_guard_0127_add_topic_comments$;
--> statement-breakpoint

-- Source: 0128_notifications_add_workspace_id.sql
-- Historical created_at: 1784898202325
DO $comhub_guard_0128_notifications_add_workspace_id$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1784898202325
  ) THEN
    EXECUTE $comhub_sql_0128_notifications_add_workspace_id_0$
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workspace_id" text;
$comhub_sql_0128_notifications_add_workspace_id_0$;
    EXECUTE $comhub_sql_0128_notifications_add_workspace_id_1$
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_workspace_id_workspaces_id_fk";
$comhub_sql_0128_notifications_add_workspace_id_1$;
    EXECUTE $comhub_sql_0128_notifications_add_workspace_id_2$
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0128_notifications_add_workspace_id_2$;
    EXECUTE $comhub_sql_0128_notifications_add_workspace_id_3$
-- Hot notifications indexes.
--
-- On cloud production these indexes must be built online before deploy:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notifications_user_workspace"
--   ON "notifications" USING btree ("user_id","workspace_id");
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notifications_workspace_id"
--   ON "notifications" USING btree ("workspace_id");
--
-- The guarded statements below are then NO-OPs on databases that already have
-- the indexes, while fresh / self-hosted databases still converge to the
-- target schema during normal migration replay. Keep these statements
-- non-CONCURRENTLY so local PGlite / normal migration replay remains
-- compatible.
CREATE INDEX IF NOT EXISTS "idx_notifications_user_workspace" ON "notifications" USING btree ("user_id","workspace_id");
$comhub_sql_0128_notifications_add_workspace_id_3$;
    EXECUTE $comhub_sql_0128_notifications_add_workspace_id_4$
CREATE INDEX IF NOT EXISTS "idx_notifications_workspace_id" ON "notifications" USING btree ("workspace_id");
$comhub_sql_0128_notifications_add_workspace_id_4$;
  END IF;
END
$comhub_guard_0128_notifications_add_workspace_id$;
--> statement-breakpoint

-- Source: 0129_workspace_members_unique_active_owner.sql
-- Historical created_at: 1784941780510
DO $comhub_guard_0129_workspace_members_unique_active_owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1784941780510
  ) THEN
    EXECUTE $comhub_sql_0129_workspace_members_unique_active_owner_0$
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_members_unique_active_owner_idx" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner' AND "workspace_members"."deleted_at" IS NULL;
$comhub_sql_0129_workspace_members_unique_active_owner_0$;
  END IF;
END
$comhub_guard_0129_workspace_members_unique_active_owner$;
--> statement-breakpoint

-- Source: 0130_notifications_add_context.sql
-- Historical created_at: 1785044468256
DO $comhub_guard_0130_notifications_add_context$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1785044468256
  ) THEN
    EXECUTE $comhub_sql_0130_notifications_add_context_0$
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "context" text;
$comhub_sql_0130_notifications_add_context_0$;
  END IF;
END
$comhub_guard_0130_notifications_add_context$;
--> statement-breakpoint

-- Source: 0131_agents_add_name_column.sql
-- Historical created_at: 1785648308270
DO $comhub_guard_0131_agents_add_name_column$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1785648308270
  ) THEN
    EXECUTE $comhub_sql_0131_agents_add_name_column_0$
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "name" varchar(255);
$comhub_sql_0131_agents_add_name_column_0$;
  END IF;
END
$comhub_guard_0131_agents_add_name_column$;
--> statement-breakpoint

-- Source: 0132_add_agent_labels.sql
-- Historical created_at: 1785715746144
DO $comhub_guard_0132_add_agent_labels$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1785715746144
  ) THEN
    EXECUTE $comhub_sql_0132_add_agent_labels_0$
-- A previous revision of this migration created both tables with a text `id`
-- (prefixed nanoid). Any database that applied it would otherwise keep the old
-- column type, because the journal tag is unchanged and the CREATE statements
-- below are guarded by IF NOT EXISTS. Dropping first is safe: both tables are
-- new, empty, and the feature they back is not live. Assignments go first so
-- the foreign key to agent_labels is gone before that table is dropped.
DROP TABLE IF EXISTS "agent_label_assignments";
$comhub_sql_0132_add_agent_labels_0$;
    EXECUTE $comhub_sql_0132_add_agent_labels_1$
DROP TABLE IF EXISTS "agent_labels";
$comhub_sql_0132_add_agent_labels_1$;
    EXECUTE $comhub_sql_0132_add_agent_labels_2$
CREATE TABLE IF NOT EXISTS "agent_label_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0132_add_agent_labels_2$;
    EXECUTE $comhub_sql_0132_add_agent_labels_3$
CREATE TABLE IF NOT EXISTS "agent_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0132_add_agent_labels_3$;
    EXECUTE $comhub_sql_0132_add_agent_labels_4$
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_label_id_agent_labels_id_fk";
$comhub_sql_0132_add_agent_labels_4$;
    EXECUTE $comhub_sql_0132_add_agent_labels_5$
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_label_id_agent_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."agent_labels"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_5$;
    EXECUTE $comhub_sql_0132_add_agent_labels_6$
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_agent_id_agents_id_fk";
$comhub_sql_0132_add_agent_labels_6$;
    EXECUTE $comhub_sql_0132_add_agent_labels_7$
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_7$;
    EXECUTE $comhub_sql_0132_add_agent_labels_8$
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_user_id_users_id_fk";
$comhub_sql_0132_add_agent_labels_8$;
    EXECUTE $comhub_sql_0132_add_agent_labels_9$
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_9$;
    EXECUTE $comhub_sql_0132_add_agent_labels_10$
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_workspace_id_workspaces_id_fk";
$comhub_sql_0132_add_agent_labels_10$;
    EXECUTE $comhub_sql_0132_add_agent_labels_11$
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_11$;
    EXECUTE $comhub_sql_0132_add_agent_labels_12$
ALTER TABLE "agent_labels" DROP CONSTRAINT IF EXISTS "agent_labels_user_id_users_id_fk";
$comhub_sql_0132_add_agent_labels_12$;
    EXECUTE $comhub_sql_0132_add_agent_labels_13$
ALTER TABLE "agent_labels" ADD CONSTRAINT "agent_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_13$;
    EXECUTE $comhub_sql_0132_add_agent_labels_14$
ALTER TABLE "agent_labels" DROP CONSTRAINT IF EXISTS "agent_labels_workspace_id_workspaces_id_fk";
$comhub_sql_0132_add_agent_labels_14$;
    EXECUTE $comhub_sql_0132_add_agent_labels_15$
ALTER TABLE "agent_labels" ADD CONSTRAINT "agent_labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0132_add_agent_labels_15$;
    EXECUTE $comhub_sql_0132_add_agent_labels_16$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_label_assignments_label_id_agent_id_unique" ON "agent_label_assignments" USING btree ("label_id","agent_id");
$comhub_sql_0132_add_agent_labels_16$;
    EXECUTE $comhub_sql_0132_add_agent_labels_17$
CREATE INDEX IF NOT EXISTS "agent_label_assignments_agent_id_idx" ON "agent_label_assignments" USING btree ("agent_id");
$comhub_sql_0132_add_agent_labels_17$;
    EXECUTE $comhub_sql_0132_add_agent_labels_18$
CREATE INDEX IF NOT EXISTS "agent_label_assignments_workspace_id_idx" ON "agent_label_assignments" USING btree ("workspace_id");
$comhub_sql_0132_add_agent_labels_18$;
    EXECUTE $comhub_sql_0132_add_agent_labels_19$
CREATE INDEX IF NOT EXISTS "agent_labels_user_id_idx" ON "agent_labels" USING btree ("user_id");
$comhub_sql_0132_add_agent_labels_19$;
    EXECUTE $comhub_sql_0132_add_agent_labels_20$
CREATE INDEX IF NOT EXISTS "agent_labels_workspace_id_idx" ON "agent_labels" USING btree ("workspace_id");
$comhub_sql_0132_add_agent_labels_20$;
    EXECUTE $comhub_sql_0132_add_agent_labels_21$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_labels_user_id_name_unique" ON "agent_labels" USING btree ("user_id","name") WHERE "agent_labels"."workspace_id" IS NULL AND "agent_labels"."archived" = false;
$comhub_sql_0132_add_agent_labels_21$;
    EXECUTE $comhub_sql_0132_add_agent_labels_22$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_labels_workspace_id_name_unique" ON "agent_labels" USING btree ("workspace_id","name") WHERE "agent_labels"."workspace_id" IS NOT NULL AND "agent_labels"."archived" = false;
$comhub_sql_0132_add_agent_labels_22$;
  END IF;
END
$comhub_guard_0132_add_agent_labels$;
--> statement-breakpoint

-- Source: 0133_common_veda.sql
-- Historical created_at: 1786032217905
DO $comhub_guard_0133_common_veda$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786032217905
  ) THEN
    EXECUTE $comhub_sql_0133_common_veda_0$
CREATE TABLE IF NOT EXISTS "agent_history_job_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"agent_id" text NOT NULL
);
$comhub_sql_0133_common_veda_0$;
    EXECUTE $comhub_sql_0133_common_veda_1$
CREATE TABLE IF NOT EXISTS "agent_history_job_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"activity_at" timestamp with time zone NOT NULL
);
$comhub_sql_0133_common_veda_1$;
    EXECUTE $comhub_sql_0133_common_veda_2$
CREATE TABLE IF NOT EXISTS "agent_history_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text DEFAULT 'transfer' NOT NULL,
	"agent_ids" jsonb NOT NULL,
	"session_ids" jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_user_id" text NOT NULL,
	"source_workspace_id" text,
	"target_user_id" text NOT NULL,
	"target_workspace_id" text,
	"total_topics" integer NOT NULL,
	"completed_topics" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0133_common_veda_2$;
    EXECUTE $comhub_sql_0133_common_veda_3$
ALTER TABLE "agent_history_job_agents" DROP CONSTRAINT IF EXISTS "agent_history_job_agents_job_id_agent_history_jobs_id_fk";
$comhub_sql_0133_common_veda_3$;
    EXECUTE $comhub_sql_0133_common_veda_4$
ALTER TABLE "agent_history_job_agents" ADD CONSTRAINT "agent_history_job_agents_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0133_common_veda_4$;
    EXECUTE $comhub_sql_0133_common_veda_5$
ALTER TABLE "agent_history_job_agents" DROP CONSTRAINT IF EXISTS "agent_history_job_agents_agent_id_agents_id_fk";
$comhub_sql_0133_common_veda_5$;
    EXECUTE $comhub_sql_0133_common_veda_6$
ALTER TABLE "agent_history_job_agents" ADD CONSTRAINT "agent_history_job_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0133_common_veda_6$;
    EXECUTE $comhub_sql_0133_common_veda_7$
ALTER TABLE "agent_history_job_topics" DROP CONSTRAINT IF EXISTS "agent_history_job_topics_job_id_agent_history_jobs_id_fk";
$comhub_sql_0133_common_veda_7$;
    EXECUTE $comhub_sql_0133_common_veda_8$
ALTER TABLE "agent_history_job_topics" ADD CONSTRAINT "agent_history_job_topics_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0133_common_veda_8$;
    EXECUTE $comhub_sql_0133_common_veda_9$
ALTER TABLE "agent_history_job_topics" DROP CONSTRAINT IF EXISTS "agent_history_job_topics_topic_id_topics_id_fk";
$comhub_sql_0133_common_veda_9$;
    EXECUTE $comhub_sql_0133_common_veda_10$
ALTER TABLE "agent_history_job_topics" ADD CONSTRAINT "agent_history_job_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0133_common_veda_10$;
    EXECUTE $comhub_sql_0133_common_veda_11$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_history_job_agents_job_id_agent_id_unique" ON "agent_history_job_agents" USING btree ("job_id","agent_id");
$comhub_sql_0133_common_veda_11$;
    EXECUTE $comhub_sql_0133_common_veda_12$
CREATE INDEX IF NOT EXISTS "agent_history_job_agents_agent_id_idx" ON "agent_history_job_agents" USING btree ("agent_id");
$comhub_sql_0133_common_veda_12$;
    EXECUTE $comhub_sql_0133_common_veda_13$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_history_job_topics_job_id_topic_id_unique" ON "agent_history_job_topics" USING btree ("job_id","topic_id");
$comhub_sql_0133_common_veda_13$;
    EXECUTE $comhub_sql_0133_common_veda_14$
CREATE INDEX IF NOT EXISTS "agent_history_job_topics_topic_id_idx" ON "agent_history_job_topics" USING btree ("topic_id");
$comhub_sql_0133_common_veda_14$;
    EXECUTE $comhub_sql_0133_common_veda_15$
CREATE INDEX IF NOT EXISTS "agent_history_job_topics_pick_idx" ON "agent_history_job_topics" USING btree ("job_id","priority","activity_at");
$comhub_sql_0133_common_veda_15$;
    EXECUTE $comhub_sql_0133_common_veda_16$
CREATE INDEX IF NOT EXISTS "agent_history_jobs_status_idx" ON "agent_history_jobs" USING btree ("status");
$comhub_sql_0133_common_veda_16$;
    EXECUTE $comhub_sql_0133_common_veda_17$
CREATE INDEX IF NOT EXISTS "agent_history_jobs_source_user_id_idx" ON "agent_history_jobs" USING btree ("source_user_id");
$comhub_sql_0133_common_veda_17$;
    EXECUTE $comhub_sql_0133_common_veda_18$
CREATE INDEX IF NOT EXISTS "agent_history_jobs_target_user_id_idx" ON "agent_history_jobs" USING btree ("target_user_id");
$comhub_sql_0133_common_veda_18$;
    EXECUTE $comhub_sql_0133_common_veda_19$
CREATE INDEX IF NOT EXISTS "agent_history_jobs_source_workspace_id_idx" ON "agent_history_jobs" USING btree ("source_workspace_id");
$comhub_sql_0133_common_veda_19$;
    EXECUTE $comhub_sql_0133_common_veda_20$
CREATE INDEX IF NOT EXISTS "agent_history_jobs_target_workspace_id_idx" ON "agent_history_jobs" USING btree ("target_workspace_id");
$comhub_sql_0133_common_veda_20$;
  END IF;
END
$comhub_guard_0133_common_veda$;
--> statement-breakpoint

-- Source: 0134_add_projects.sql
-- Historical created_at: 1786064297919
DO $comhub_guard_0134_add_projects$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786064297919
  ) THEN
    EXECUTE $comhub_sql_0134_add_projects_0$
CREATE TABLE IF NOT EXISTS "project_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"role" text,
	"responsibility" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0134_add_projects_0$;
    EXECUTE $comhub_sql_0134_add_projects_1$
CREATE TABLE IF NOT EXISTS "project_chat_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"chat_group_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"role" text,
	"responsibility" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0134_add_projects_1$;
    EXECUTE $comhub_sql_0134_add_projects_2$
CREATE TABLE IF NOT EXISTS "project_completion_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"reviewer_user_id" text,
	"workspace_id" text,
	"round" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_completion_reviews_round_positive" CHECK ("project_completion_reviews"."round" > 0)
);
$comhub_sql_0134_add_projects_2$;
    EXECUTE $comhub_sql_0134_add_projects_3$
CREATE TABLE IF NOT EXISTS "project_knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0134_add_projects_3$;
    EXECUTE $comhub_sql_0134_add_projects_4$
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100),
	"name" varchar(255) NOT NULL,
	"description" text,
	"avatar" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"completed_review_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_completed_requires_human_review" CHECK ("projects"."status" <> 'completed' OR ("projects"."completed_review_id" IS NOT NULL AND "projects"."completed_at" IS NOT NULL))
);
$comhub_sql_0134_add_projects_4$;
    EXECUTE $comhub_sql_0134_add_projects_5$
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" text;
$comhub_sql_0134_add_projects_5$;
    EXECUTE $comhub_sql_0134_add_projects_6$
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_project_id_projects_id_fk";
$comhub_sql_0134_add_projects_6$;
    EXECUTE $comhub_sql_0134_add_projects_7$
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_7$;
    EXECUTE $comhub_sql_0134_add_projects_8$
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_agent_id_agents_id_fk";
$comhub_sql_0134_add_projects_8$;
    EXECUTE $comhub_sql_0134_add_projects_9$
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_9$;
    EXECUTE $comhub_sql_0134_add_projects_10$
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_added_by_user_id_users_id_fk";
$comhub_sql_0134_add_projects_10$;
    EXECUTE $comhub_sql_0134_add_projects_11$
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0134_add_projects_11$;
    EXECUTE $comhub_sql_0134_add_projects_12$
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_workspace_id_workspaces_id_fk";
$comhub_sql_0134_add_projects_12$;
    EXECUTE $comhub_sql_0134_add_projects_13$
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_13$;
    EXECUTE $comhub_sql_0134_add_projects_14$
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_project_id_projects_id_fk";
$comhub_sql_0134_add_projects_14$;
    EXECUTE $comhub_sql_0134_add_projects_15$
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_15$;
    EXECUTE $comhub_sql_0134_add_projects_16$
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_chat_group_id_chat_groups_id_fk";
$comhub_sql_0134_add_projects_16$;
    EXECUTE $comhub_sql_0134_add_projects_17$
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_17$;
    EXECUTE $comhub_sql_0134_add_projects_18$
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_added_by_user_id_users_id_fk";
$comhub_sql_0134_add_projects_18$;
    EXECUTE $comhub_sql_0134_add_projects_19$
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0134_add_projects_19$;
    EXECUTE $comhub_sql_0134_add_projects_20$
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_workspace_id_workspaces_id_fk";
$comhub_sql_0134_add_projects_20$;
    EXECUTE $comhub_sql_0134_add_projects_21$
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_21$;
    EXECUTE $comhub_sql_0134_add_projects_22$
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_project_id_projects_id_fk";
$comhub_sql_0134_add_projects_22$;
    EXECUTE $comhub_sql_0134_add_projects_23$
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_23$;
    EXECUTE $comhub_sql_0134_add_projects_24$
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_reviewer_user_id_users_id_fk";
$comhub_sql_0134_add_projects_24$;
    EXECUTE $comhub_sql_0134_add_projects_25$
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0134_add_projects_25$;
    EXECUTE $comhub_sql_0134_add_projects_26$
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_workspace_id_workspaces_id_fk";
$comhub_sql_0134_add_projects_26$;
    EXECUTE $comhub_sql_0134_add_projects_27$
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_27$;
    EXECUTE $comhub_sql_0134_add_projects_28$
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_project_id_projects_id_fk";
$comhub_sql_0134_add_projects_28$;
    EXECUTE $comhub_sql_0134_add_projects_29$
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_29$;
    EXECUTE $comhub_sql_0134_add_projects_30$
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk";
$comhub_sql_0134_add_projects_30$;
    EXECUTE $comhub_sql_0134_add_projects_31$
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_31$;
    EXECUTE $comhub_sql_0134_add_projects_32$
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_added_by_user_id_users_id_fk";
$comhub_sql_0134_add_projects_32$;
    EXECUTE $comhub_sql_0134_add_projects_33$
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0134_add_projects_33$;
    EXECUTE $comhub_sql_0134_add_projects_34$
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_workspace_id_workspaces_id_fk";
$comhub_sql_0134_add_projects_34$;
    EXECUTE $comhub_sql_0134_add_projects_35$
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_35$;
    EXECUTE $comhub_sql_0134_add_projects_36$
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_user_id_users_id_fk";
$comhub_sql_0134_add_projects_36$;
    EXECUTE $comhub_sql_0134_add_projects_37$
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_37$;
    EXECUTE $comhub_sql_0134_add_projects_38$
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_workspace_id_workspaces_id_fk";
$comhub_sql_0134_add_projects_38$;
    EXECUTE $comhub_sql_0134_add_projects_39$
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0134_add_projects_39$;
    EXECUTE $comhub_sql_0134_add_projects_40$
CREATE UNIQUE INDEX IF NOT EXISTS "project_agents_project_id_agent_id_unique" ON "project_agents" USING btree ("project_id","agent_id");
$comhub_sql_0134_add_projects_40$;
    EXECUTE $comhub_sql_0134_add_projects_41$
CREATE INDEX IF NOT EXISTS "project_agents_project_id_sort_order_idx" ON "project_agents" USING btree ("project_id","sort_order");
$comhub_sql_0134_add_projects_41$;
    EXECUTE $comhub_sql_0134_add_projects_42$
CREATE INDEX IF NOT EXISTS "project_agents_agent_id_idx" ON "project_agents" USING btree ("agent_id");
$comhub_sql_0134_add_projects_42$;
    EXECUTE $comhub_sql_0134_add_projects_43$
CREATE INDEX IF NOT EXISTS "project_agents_workspace_id_idx" ON "project_agents" USING btree ("workspace_id");
$comhub_sql_0134_add_projects_43$;
    EXECUTE $comhub_sql_0134_add_projects_44$
CREATE UNIQUE INDEX IF NOT EXISTS "project_chat_groups_project_id_chat_group_id_unique" ON "project_chat_groups" USING btree ("project_id","chat_group_id");
$comhub_sql_0134_add_projects_44$;
    EXECUTE $comhub_sql_0134_add_projects_45$
CREATE INDEX IF NOT EXISTS "project_chat_groups_project_id_sort_order_idx" ON "project_chat_groups" USING btree ("project_id","sort_order");
$comhub_sql_0134_add_projects_45$;
    EXECUTE $comhub_sql_0134_add_projects_46$
CREATE INDEX IF NOT EXISTS "project_chat_groups_chat_group_id_idx" ON "project_chat_groups" USING btree ("chat_group_id");
$comhub_sql_0134_add_projects_46$;
    EXECUTE $comhub_sql_0134_add_projects_47$
CREATE INDEX IF NOT EXISTS "project_chat_groups_workspace_id_idx" ON "project_chat_groups" USING btree ("workspace_id");
$comhub_sql_0134_add_projects_47$;
    EXECUTE $comhub_sql_0134_add_projects_48$
CREATE UNIQUE INDEX IF NOT EXISTS "project_completion_reviews_project_id_round_unique" ON "project_completion_reviews" USING btree ("project_id","round");
$comhub_sql_0134_add_projects_48$;
    EXECUTE $comhub_sql_0134_add_projects_49$
CREATE INDEX IF NOT EXISTS "project_completion_reviews_project_id_created_at_idx" ON "project_completion_reviews" USING btree ("project_id","created_at");
$comhub_sql_0134_add_projects_49$;
    EXECUTE $comhub_sql_0134_add_projects_50$
CREATE INDEX IF NOT EXISTS "project_completion_reviews_reviewer_user_id_idx" ON "project_completion_reviews" USING btree ("reviewer_user_id");
$comhub_sql_0134_add_projects_50$;
    EXECUTE $comhub_sql_0134_add_projects_51$
CREATE INDEX IF NOT EXISTS "project_completion_reviews_workspace_id_idx" ON "project_completion_reviews" USING btree ("workspace_id");
$comhub_sql_0134_add_projects_51$;
    EXECUTE $comhub_sql_0134_add_projects_52$
CREATE UNIQUE INDEX IF NOT EXISTS "project_knowledge_bases_project_id_knowledge_base_id_unique" ON "project_knowledge_bases" USING btree ("project_id","knowledge_base_id");
$comhub_sql_0134_add_projects_52$;
    EXECUTE $comhub_sql_0134_add_projects_53$
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_project_id_sort_order_idx" ON "project_knowledge_bases" USING btree ("project_id","sort_order");
$comhub_sql_0134_add_projects_53$;
    EXECUTE $comhub_sql_0134_add_projects_54$
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_knowledge_base_id_idx" ON "project_knowledge_bases" USING btree ("knowledge_base_id");
$comhub_sql_0134_add_projects_54$;
    EXECUTE $comhub_sql_0134_add_projects_55$
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_workspace_id_idx" ON "project_knowledge_bases" USING btree ("workspace_id");
$comhub_sql_0134_add_projects_55$;
    EXECUTE $comhub_sql_0134_add_projects_56$
CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_user_id_unique" ON "projects" USING btree ("slug","user_id") WHERE "projects"."workspace_id" IS NULL;
$comhub_sql_0134_add_projects_56$;
    EXECUTE $comhub_sql_0134_add_projects_57$
CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_workspace_id_unique" ON "projects" USING btree ("workspace_id","slug") WHERE "projects"."workspace_id" IS NOT NULL;
$comhub_sql_0134_add_projects_57$;
    EXECUTE $comhub_sql_0134_add_projects_58$
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" USING btree ("user_id");
$comhub_sql_0134_add_projects_58$;
    EXECUTE $comhub_sql_0134_add_projects_59$
CREATE INDEX IF NOT EXISTS "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");
$comhub_sql_0134_add_projects_59$;
    EXECUTE $comhub_sql_0134_add_projects_60$
CREATE INDEX IF NOT EXISTS "projects_workspace_visibility_idx" ON "projects" USING btree ("workspace_id","visibility","user_id");
$comhub_sql_0134_add_projects_60$;
    EXECUTE $comhub_sql_0134_add_projects_61$
CREATE INDEX IF NOT EXISTS "projects_status_updated_at_idx" ON "projects" USING btree ("status","updated_at");
$comhub_sql_0134_add_projects_61$;
    EXECUTE $comhub_sql_0134_add_projects_62$
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_projects_id_fk";
$comhub_sql_0134_add_projects_62$;
    EXECUTE $comhub_sql_0134_add_projects_63$
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0134_add_projects_63$;
    EXECUTE $comhub_sql_0134_add_projects_64$
CREATE INDEX IF NOT EXISTS "tasks_project_id_status_idx" ON "tasks" USING btree ("project_id","status");
$comhub_sql_0134_add_projects_64$;
  END IF;
END
$comhub_guard_0134_add_projects$;
--> statement-breakpoint

-- Source: 0135_api_keys_add_scopes.sql
-- Historical created_at: 1786117168564
DO $comhub_guard_0135_api_keys_add_scopes$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786117168564
  ) THEN
    EXECUTE $comhub_sql_0135_api_keys_add_scopes_0$
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" jsonb;
$comhub_sql_0135_api_keys_add_scopes_0$;
  END IF;
END
$comhub_guard_0135_api_keys_add_scopes$;
--> statement-breakpoint

-- Source: 0136_projects_add_identifier.sql
-- Historical created_at: 1786138599832
DO $comhub_guard_0136_projects_add_identifier$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786138599832
  ) THEN
    EXECUTE $comhub_sql_0136_projects_add_identifier_0$
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "identifier" varchar(6) NOT NULL;
$comhub_sql_0136_projects_add_identifier_0$;
    EXECUTE $comhub_sql_0136_projects_add_identifier_1$
CREATE UNIQUE INDEX IF NOT EXISTS "projects_identifier_user_id_unique" ON "projects" USING btree ("identifier","user_id") WHERE "projects"."workspace_id" IS NULL;
$comhub_sql_0136_projects_add_identifier_1$;
    EXECUTE $comhub_sql_0136_projects_add_identifier_2$
CREATE UNIQUE INDEX IF NOT EXISTS "projects_identifier_workspace_id_unique" ON "projects" USING btree ("workspace_id","identifier") WHERE "projects"."workspace_id" IS NOT NULL;
$comhub_sql_0136_projects_add_identifier_2$;
  END IF;
END
$comhub_guard_0136_projects_add_identifier$;
--> statement-breakpoint

-- Source: 0137_agent_history_jobs_payload.sql
-- Historical created_at: 1786151567302
DO $comhub_guard_0137_agent_history_jobs_payload$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786151567302
  ) THEN
    EXECUTE $comhub_sql_0137_agent_history_jobs_payload_0$
ALTER TABLE "agent_history_job_topics" ADD COLUMN IF NOT EXISTS "payload" jsonb;
$comhub_sql_0137_agent_history_jobs_payload_0$;
    EXECUTE $comhub_sql_0137_agent_history_jobs_payload_1$
ALTER TABLE "agent_history_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb;
$comhub_sql_0137_agent_history_jobs_payload_1$;
  END IF;
END
$comhub_guard_0137_agent_history_jobs_payload$;
--> statement-breakpoint

-- Source: 0138_agent_history_job_groups.sql
-- Historical created_at: 1786166809665
DO $comhub_guard_0138_agent_history_job_groups$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786166809665
  ) THEN
    EXECUTE $comhub_sql_0138_agent_history_job_groups_0$
CREATE TABLE IF NOT EXISTS "agent_history_job_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"group_id" text NOT NULL
);
$comhub_sql_0138_agent_history_job_groups_0$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_1$
ALTER TABLE "agent_history_job_groups" DROP CONSTRAINT IF EXISTS "agent_history_job_groups_job_id_agent_history_jobs_id_fk";
$comhub_sql_0138_agent_history_job_groups_1$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_2$
ALTER TABLE "agent_history_job_groups" ADD CONSTRAINT "agent_history_job_groups_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0138_agent_history_job_groups_2$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_3$
ALTER TABLE "agent_history_job_groups" DROP CONSTRAINT IF EXISTS "agent_history_job_groups_group_id_chat_groups_id_fk";
$comhub_sql_0138_agent_history_job_groups_3$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_4$
ALTER TABLE "agent_history_job_groups" ADD CONSTRAINT "agent_history_job_groups_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0138_agent_history_job_groups_4$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_5$
CREATE UNIQUE INDEX IF NOT EXISTS "agent_history_job_groups_job_id_group_id_unique" ON "agent_history_job_groups" USING btree ("job_id","group_id");
$comhub_sql_0138_agent_history_job_groups_5$;
    EXECUTE $comhub_sql_0138_agent_history_job_groups_6$
CREATE INDEX IF NOT EXISTS "agent_history_job_groups_group_id_idx" ON "agent_history_job_groups" USING btree ("group_id");
$comhub_sql_0138_agent_history_job_groups_6$;
  END IF;
END
$comhub_guard_0138_agent_history_job_groups$;
--> statement-breakpoint

-- Source: 0139_projects_add_coordinator_agent.sql
-- Historical created_at: 1786316226126
DO $comhub_guard_0139_projects_add_coordinator_agent$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786316226126
  ) THEN
    EXECUTE $comhub_sql_0139_projects_add_coordinator_agent_0$
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "coordinator_agent_id" text NOT NULL;
$comhub_sql_0139_projects_add_coordinator_agent_0$;
    EXECUTE $comhub_sql_0139_projects_add_coordinator_agent_1$
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_coordinator_agent_id_agents_id_fk";
$comhub_sql_0139_projects_add_coordinator_agent_1$;
    EXECUTE $comhub_sql_0139_projects_add_coordinator_agent_2$
ALTER TABLE "projects" ADD CONSTRAINT "projects_coordinator_agent_id_agents_id_fk" FOREIGN KEY ("coordinator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;
$comhub_sql_0139_projects_add_coordinator_agent_2$;
    EXECUTE $comhub_sql_0139_projects_add_coordinator_agent_3$
CREATE UNIQUE INDEX IF NOT EXISTS "projects_coordinator_agent_id_unique" ON "projects" USING btree ("coordinator_agent_id");
$comhub_sql_0139_projects_add_coordinator_agent_3$;
  END IF;
END
$comhub_guard_0139_projects_add_coordinator_agent$;
--> statement-breakpoint

-- Source: 0140_productive_madripoor.sql
-- Historical created_at: 1786545606298
DO $comhub_guard_0140_productive_madripoor$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786545606298
  ) THEN
    EXECUTE $comhub_sql_0140_productive_madripoor_0$
CREATE TABLE IF NOT EXISTS "verify_review_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_result_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"action" text,
	"status_reason" text,
	"confidence" numeric(3, 2),
	"comment" text,
	"rationale" text,
	"annotations" jsonb,
	"adjudication" text,
	"adjudication_edit" text,
	"adjudicated_at" timestamp with time zone,
	"latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verify_review_predictions_action_matches_status" CHECK (("verify_review_predictions"."status" = 'judged') = ("verify_review_predictions"."action" IS NOT NULL))
);
$comhub_sql_0140_productive_madripoor_0$;
    EXECUTE $comhub_sql_0140_productive_madripoor_1$
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_check_result_id_verify_check_results_id_fk";
$comhub_sql_0140_productive_madripoor_1$;
    EXECUTE $comhub_sql_0140_productive_madripoor_2$
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_check_result_id_verify_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "public"."verify_check_results"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0140_productive_madripoor_2$;
    EXECUTE $comhub_sql_0140_productive_madripoor_3$
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_user_id_users_id_fk";
$comhub_sql_0140_productive_madripoor_3$;
    EXECUTE $comhub_sql_0140_productive_madripoor_4$
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0140_productive_madripoor_4$;
    EXECUTE $comhub_sql_0140_productive_madripoor_5$
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_workspace_id_workspaces_id_fk";
$comhub_sql_0140_productive_madripoor_5$;
    EXECUTE $comhub_sql_0140_productive_madripoor_6$
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0140_productive_madripoor_6$;
    EXECUTE $comhub_sql_0140_productive_madripoor_7$
CREATE INDEX IF NOT EXISTS "verify_review_predictions_check_result_id_idx" ON "verify_review_predictions" USING btree ("check_result_id");
$comhub_sql_0140_productive_madripoor_7$;
    EXECUTE $comhub_sql_0140_productive_madripoor_8$
CREATE INDEX IF NOT EXISTS "verify_review_predictions_user_id_idx" ON "verify_review_predictions" USING btree ("user_id");
$comhub_sql_0140_productive_madripoor_8$;
    EXECUTE $comhub_sql_0140_productive_madripoor_9$
CREATE INDEX IF NOT EXISTS "verify_review_predictions_workspace_id_idx" ON "verify_review_predictions" USING btree ("workspace_id");
$comhub_sql_0140_productive_madripoor_9$;
    EXECUTE $comhub_sql_0140_productive_madripoor_10$
CREATE INDEX IF NOT EXISTS "verify_review_predictions_model_idx" ON "verify_review_predictions" USING btree ("provider","model");
$comhub_sql_0140_productive_madripoor_10$;
    EXECUTE $comhub_sql_0140_productive_madripoor_11$
CREATE UNIQUE INDEX IF NOT EXISTS "verify_review_predictions_result_model_prompt_unique" ON "verify_review_predictions" USING btree ("check_result_id","provider","model","prompt_version");
$comhub_sql_0140_productive_madripoor_11$;
  END IF;
END
$comhub_guard_0140_productive_madripoor$;
--> statement-breakpoint

-- Source: 0141_goals.sql
-- Historical created_at: 1786766455568
DO $comhub_guard_0141_goals$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786766455568
  ) THEN
    EXECUTE $comhub_sql_0141_goals_0$
CREATE TABLE IF NOT EXISTS "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"agent_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"requirement" text,
	"max_rounds" integer,
	"max_total_cost" numeric(20, 6),
	"status" text DEFAULT 'planning' NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0141_goals_0$;
    EXECUTE $comhub_sql_0141_goals_1$
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_user_id_users_id_fk";
$comhub_sql_0141_goals_1$;
    EXECUTE $comhub_sql_0141_goals_2$
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0141_goals_2$;
    EXECUTE $comhub_sql_0141_goals_3$
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_workspace_id_workspaces_id_fk";
$comhub_sql_0141_goals_3$;
    EXECUTE $comhub_sql_0141_goals_4$
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0141_goals_4$;
    EXECUTE $comhub_sql_0141_goals_5$
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_agent_id_agents_id_fk";
$comhub_sql_0141_goals_5$;
    EXECUTE $comhub_sql_0141_goals_6$
ALTER TABLE "goals" ADD CONSTRAINT "goals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0141_goals_6$;
    EXECUTE $comhub_sql_0141_goals_7$
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_project_id_projects_id_fk";
$comhub_sql_0141_goals_7$;
    EXECUTE $comhub_sql_0141_goals_8$
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0141_goals_8$;
    EXECUTE $comhub_sql_0141_goals_9$
CREATE INDEX IF NOT EXISTS "goals_user_id_idx" ON "goals" USING btree ("user_id");
$comhub_sql_0141_goals_9$;
    EXECUTE $comhub_sql_0141_goals_10$
CREATE INDEX IF NOT EXISTS "goals_workspace_id_idx" ON "goals" USING btree ("workspace_id");
$comhub_sql_0141_goals_10$;
    EXECUTE $comhub_sql_0141_goals_11$
CREATE INDEX IF NOT EXISTS "goals_agent_id_idx" ON "goals" USING btree ("agent_id");
$comhub_sql_0141_goals_11$;
    EXECUTE $comhub_sql_0141_goals_12$
CREATE INDEX IF NOT EXISTS "goals_project_id_idx" ON "goals" USING btree ("project_id");
$comhub_sql_0141_goals_12$;
    EXECUTE $comhub_sql_0141_goals_13$
CREATE INDEX IF NOT EXISTS "goals_status_idx" ON "goals" USING btree ("status");
$comhub_sql_0141_goals_13$;
    EXECUTE $comhub_sql_0141_goals_14$
CREATE INDEX IF NOT EXISTS "goals_subject_idx" ON "goals" USING btree ("subject_type","subject_id");
$comhub_sql_0141_goals_14$;
  END IF;
END
$comhub_guard_0141_goals$;
--> statement-breakpoint

-- Source: 0142_expertise_domain_tables.sql
-- Historical created_at: 1786791246437
DO $comhub_guard_0142_expertise_domain_tables$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786791246437
  ) THEN
    EXECUTE $comhub_sql_0142_expertise_domain_tables_0$
CREATE TABLE IF NOT EXISTS "expertise_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"agent_id" text,
	"project_id" text,
	"bound_workspace_id" text,
	"bound_user_id" text,
	"contribution_mode" text DEFAULT 'derive' NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_bindings_exactly_one_carrier" CHECK (("expertise_bindings"."agent_id" IS NOT NULL)::int + ("expertise_bindings"."project_id" IS NOT NULL)::int + ("expertise_bindings"."bound_workspace_id" IS NOT NULL)::int + ("expertise_bindings"."bound_user_id" IS NOT NULL)::int = 1)
);
$comhub_sql_0142_expertise_domain_tables_0$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_1$
CREATE TABLE IF NOT EXISTS "expertise_domain_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"run_id" uuid,
	"run_index" integer NOT NULL,
	"learned_total" integer NOT NULL,
	"retired_total" integer DEFAULT 0 NOT NULL,
	"active_count" integer NOT NULL,
	"compiled_count" integer DEFAULT 0 NOT NULL,
	"layer_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"p_inf" numeric,
	"tau" numeric,
	"maturity" numeric,
	"fit_sample_size" integer,
	"fit_r2" numeric,
	"fit_confidence" text,
	"fit_computed_at" timestamp with time zone,
	"tau_pinned" boolean DEFAULT false NOT NULL,
	"observed_span" numeric,
	"plateau_kind" text,
	"layer_coverage" numeric,
	"canon_coverage" numeric,
	"active_rate" numeric,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0142_expertise_domain_tables_1$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_2$
CREATE TABLE IF NOT EXISTS "expertise_domains" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"parent_domain_id" varchar(255),
	"domain_filter" text NOT NULL,
	"out_of_scope" text,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"layer_source" text DEFAULT 'invented' NOT NULL,
	"canon_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canon_document_id" varchar(255),
	"flow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_spec" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lesson_base_document_id" varchar(255),
	"anchor_candidates" jsonb,
	"anchor_chosen_at" timestamp with time zone,
	"anchor_chosen_by_user_id" text,
	"seed_state" text DEFAULT 'seeding' NOT NULL,
	"seed_run_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0142_expertise_domain_tables_2$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_3$
CREATE TABLE IF NOT EXISTS "expertise_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"outcome" text NOT NULL,
	"where" text,
	"note" text,
	"example" text,
	"severity" text,
	"evidence_id" uuid,
	"operation_id" text,
	"user_decision" text,
	"user_decision_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0142_expertise_domain_tables_3$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_4$
CREATE TABLE IF NOT EXISTS "expertise_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255),
	"user_id" text,
	"workspace_id" text,
	"kind" varchar(255) NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"action_label" text,
	"action_target" jsonb,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real,
	"status" text DEFAULT 'active' NOT NULL,
	"dismiss_reason" text,
	"stale_after_run_index" integer,
	"generated_by_operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0142_expertise_domain_tables_4$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_5$
CREATE TABLE IF NOT EXISTS "expertise_lesson_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"sections" jsonb NOT NULL,
	"feedback" text,
	"changed_by" text NOT NULL,
	"kind" text DEFAULT 'user-feedback' NOT NULL,
	"prev_title" text,
	"changed_by_user_id" text,
	"source_run_id" uuid,
	"operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0142_expertise_domain_tables_5$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_6$
CREATE TABLE IF NOT EXISTS "expertise_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"created_by_user_id" text,
	"code" varchar(20) NOT NULL,
	"polarity" text NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb NOT NULL,
	"layer" varchar(255),
	"tags" text[],
	"canon_anchor" text,
	"origin_run_id" uuid,
	"origin_hit_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"rejected_reason" text,
	"salvaged_from_id" uuid,
	"retired_at" timestamp with time zone,
	"compilability" text DEFAULT 'compilable' NOT NULL,
	"compiled_criterion_id" uuid,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"hit_run_count" integer DEFAULT 0 NOT NULL,
	"false_positive_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"last_hit_run_id" uuid,
	"generalized_from_ids" jsonb,
	"specificity" text,
	"example_count" integer DEFAULT 0 NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_lessons_id_domain_unique" UNIQUE("id","domain_id")
);
$comhub_sql_0142_expertise_domain_tables_6$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_7$
CREATE TABLE IF NOT EXISTS "expertise_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"run_index" integer NOT NULL,
	"is_seed_run" boolean DEFAULT false NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"reflection_key" varchar(255),
	"had_human_in_loop" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"instance_count" integer DEFAULT 0 NOT NULL,
	"refine_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_runs_id_domain_unique" UNIQUE("id","domain_id")
);
$comhub_sql_0142_expertise_domain_tables_7$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_8$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_8$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_9$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_9$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_10$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_agent_id_agents_id_fk";
$comhub_sql_0142_expertise_domain_tables_10$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_11$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_11$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_12$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_project_id_projects_id_fk";
$comhub_sql_0142_expertise_domain_tables_12$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_13$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_13$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_14$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_bound_workspace_id_workspaces_id_fk";
$comhub_sql_0142_expertise_domain_tables_14$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_15$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_bound_workspace_id_workspaces_id_fk" FOREIGN KEY ("bound_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_15$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_16$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_bound_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_16$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_17$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_bound_user_id_users_id_fk" FOREIGN KEY ("bound_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_17$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_18$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_added_by_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_18$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_19$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_19$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_20$
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_workspace_id_workspaces_id_fk";
$comhub_sql_0142_expertise_domain_tables_20$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_21$
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_21$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_22$
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_22$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_23$
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_23$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_24$
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_run_id_expertise_runs_id_fk";
$comhub_sql_0142_expertise_domain_tables_24$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_25$
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_run_id_expertise_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."expertise_runs"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_25$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_26$
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_run_domain_fk";
$comhub_sql_0142_expertise_domain_tables_26$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_27$
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_run_domain_fk" FOREIGN KEY ("run_id","domain_id") REFERENCES "public"."expertise_runs"("id","domain_id") ON DELETE no action ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_27$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_28$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_28$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_29$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_29$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_30$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_workspace_id_workspaces_id_fk";
$comhub_sql_0142_expertise_domain_tables_30$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_31$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_31$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_32$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_parent_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_32$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_33$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_parent_domain_id_expertise_domains_id_fk" FOREIGN KEY ("parent_domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_33$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_34$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_canon_document_id_documents_id_fk";
$comhub_sql_0142_expertise_domain_tables_34$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_35$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_canon_document_id_documents_id_fk" FOREIGN KEY ("canon_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_35$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_36$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_lesson_base_document_id_documents_id_fk";
$comhub_sql_0142_expertise_domain_tables_36$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_37$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_lesson_base_document_id_documents_id_fk" FOREIGN KEY ("lesson_base_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_37$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_38$
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_anchor_chosen_by_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_38$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_39$
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_anchor_chosen_by_user_id_users_id_fk" FOREIGN KEY ("anchor_chosen_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_39$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_40$
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_40$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_41$
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_41$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_42$
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_evidence_id_verify_evidence_id_fk";
$comhub_sql_0142_expertise_domain_tables_42$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_43$
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_evidence_id_verify_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."verify_evidence"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_43$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_44$
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_operation_id_agent_operations_id_fk";
$comhub_sql_0142_expertise_domain_tables_44$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_45$
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_45$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_46$
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_run_domain_fk";
$comhub_sql_0142_expertise_domain_tables_46$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_47$
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_run_domain_fk" FOREIGN KEY ("run_id","domain_id") REFERENCES "public"."expertise_runs"("id","domain_id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_47$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_48$
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_lesson_domain_fk";
$comhub_sql_0142_expertise_domain_tables_48$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_49$
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_lesson_domain_fk" FOREIGN KEY ("lesson_id","domain_id") REFERENCES "public"."expertise_lessons"("id","domain_id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_49$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_50$
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_50$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_51$
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_51$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_52$
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_52$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_53$
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_53$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_54$
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_workspace_id_workspaces_id_fk";
$comhub_sql_0142_expertise_domain_tables_54$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_55$
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_55$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_56$
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_generated_by_operation_id_agent_operations_id_fk";
$comhub_sql_0142_expertise_domain_tables_56$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_57$
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_generated_by_operation_id_agent_operations_id_fk" FOREIGN KEY ("generated_by_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_57$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_58$
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_lesson_id_expertise_lessons_id_fk";
$comhub_sql_0142_expertise_domain_tables_58$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_59$
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_lesson_id_expertise_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."expertise_lessons"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_59$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_60$
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_changed_by_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_60$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_61$
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_61$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_62$
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_operation_id_agent_operations_id_fk";
$comhub_sql_0142_expertise_domain_tables_62$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_63$
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_63$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_64$
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_64$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_65$
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_65$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_66$
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_created_by_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_66$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_67$
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_67$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_68$
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_salvaged_from_id_expertise_lessons_id_fk";
$comhub_sql_0142_expertise_domain_tables_68$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_69$
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_salvaged_from_id_expertise_lessons_id_fk" FOREIGN KEY ("salvaged_from_id") REFERENCES "public"."expertise_lessons"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_69$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_70$
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_compiled_criterion_id_verify_criteria_id_fk";
$comhub_sql_0142_expertise_domain_tables_70$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_71$
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_compiled_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("compiled_criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_71$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_72$
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_domain_id_expertise_domains_id_fk";
$comhub_sql_0142_expertise_domain_tables_72$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_73$
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_73$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_74$
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_user_id_users_id_fk";
$comhub_sql_0142_expertise_domain_tables_74$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_75$
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_75$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_76$
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_workspace_id_workspaces_id_fk";
$comhub_sql_0142_expertise_domain_tables_76$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_77$
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0142_expertise_domain_tables_77$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_78$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_agent_domain_unique" ON "expertise_bindings" USING btree ("agent_id","domain_id") WHERE "expertise_bindings"."agent_id" is not null;
$comhub_sql_0142_expertise_domain_tables_78$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_79$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_project_domain_unique" ON "expertise_bindings" USING btree ("project_id","domain_id") WHERE "expertise_bindings"."project_id" is not null;
$comhub_sql_0142_expertise_domain_tables_79$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_80$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_workspace_domain_unique" ON "expertise_bindings" USING btree ("bound_workspace_id","domain_id") WHERE "expertise_bindings"."bound_workspace_id" is not null;
$comhub_sql_0142_expertise_domain_tables_80$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_81$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_user_domain_unique" ON "expertise_bindings" USING btree ("bound_user_id","domain_id") WHERE "expertise_bindings"."bound_user_id" is not null;
$comhub_sql_0142_expertise_domain_tables_81$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_82$
CREATE INDEX IF NOT EXISTS "expertise_bindings_domain_idx" ON "expertise_bindings" USING btree ("domain_id");
$comhub_sql_0142_expertise_domain_tables_82$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_83$
CREATE INDEX IF NOT EXISTS "expertise_bindings_workspace_id_idx" ON "expertise_bindings" USING btree ("workspace_id");
$comhub_sql_0142_expertise_domain_tables_83$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_84$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domain_snapshots_domain_run_index_unique" ON "expertise_domain_snapshots" USING btree ("domain_id","run_index");
$comhub_sql_0142_expertise_domain_tables_84$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_85$
CREATE INDEX IF NOT EXISTS "expertise_domain_snapshots_domain_captured_idx" ON "expertise_domain_snapshots" USING btree ("domain_id","captured_at");
$comhub_sql_0142_expertise_domain_tables_85$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_86$
CREATE INDEX IF NOT EXISTS "expertise_domain_snapshots_pending_fit_idx" ON "expertise_domain_snapshots" USING btree ("domain_id") WHERE "expertise_domain_snapshots"."fit_computed_at" is null;
$comhub_sql_0142_expertise_domain_tables_86$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_87$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domains_slug_user_unique" ON "expertise_domains" USING btree ("slug","user_id") WHERE "expertise_domains"."workspace_id" is null;
$comhub_sql_0142_expertise_domain_tables_87$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_88$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domains_slug_workspace_unique" ON "expertise_domains" USING btree ("workspace_id","slug") WHERE "expertise_domains"."workspace_id" is not null;
$comhub_sql_0142_expertise_domain_tables_88$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_89$
CREATE INDEX IF NOT EXISTS "expertise_domains_user_id_idx" ON "expertise_domains" USING btree ("user_id");
$comhub_sql_0142_expertise_domain_tables_89$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_90$
CREATE INDEX IF NOT EXISTS "expertise_domains_workspace_visibility_idx" ON "expertise_domains" USING btree ("workspace_id","visibility");
$comhub_sql_0142_expertise_domain_tables_90$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_91$
CREATE INDEX IF NOT EXISTS "expertise_domains_parent_idx" ON "expertise_domains" USING btree ("parent_domain_id");
$comhub_sql_0142_expertise_domain_tables_91$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_92$
CREATE INDEX IF NOT EXISTS "expertise_hits_lesson_created_idx" ON "expertise_hits" USING btree ("lesson_id","created_at");
$comhub_sql_0142_expertise_domain_tables_92$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_93$
CREATE INDEX IF NOT EXISTS "expertise_hits_run_idx" ON "expertise_hits" USING btree ("run_id");
$comhub_sql_0142_expertise_domain_tables_93$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_94$
CREATE INDEX IF NOT EXISTS "expertise_hits_domain_outcome_idx" ON "expertise_hits" USING btree ("domain_id","outcome");
$comhub_sql_0142_expertise_domain_tables_94$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_95$
CREATE INDEX IF NOT EXISTS "expertise_hits_operation_idx" ON "expertise_hits" USING btree ("operation_id");
$comhub_sql_0142_expertise_domain_tables_95$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_96$
CREATE INDEX IF NOT EXISTS "expertise_insights_domain_status_idx" ON "expertise_insights" USING btree ("domain_id","status");
$comhub_sql_0142_expertise_domain_tables_96$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_97$
CREATE INDEX IF NOT EXISTS "expertise_insights_user_status_idx" ON "expertise_insights" USING btree ("user_id","status");
$comhub_sql_0142_expertise_domain_tables_97$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_98$
CREATE INDEX IF NOT EXISTS "expertise_insights_workspace_idx" ON "expertise_insights" USING btree ("workspace_id");
$comhub_sql_0142_expertise_domain_tables_98$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_99$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_lesson_revisions_lesson_revision_unique" ON "expertise_lesson_revisions" USING btree ("lesson_id","revision");
$comhub_sql_0142_expertise_domain_tables_99$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_100$
CREATE INDEX IF NOT EXISTS "expertise_lesson_revisions_lesson_idx" ON "expertise_lesson_revisions" USING btree ("lesson_id");
$comhub_sql_0142_expertise_domain_tables_100$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_101$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_lessons_domain_code_unique" ON "expertise_lessons" USING btree ("domain_id","code");
$comhub_sql_0142_expertise_domain_tables_101$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_102$
CREATE INDEX IF NOT EXISTS "expertise_lessons_domain_status_hits_idx" ON "expertise_lessons" USING btree ("domain_id","status","hit_count");
$comhub_sql_0142_expertise_domain_tables_102$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_103$
CREATE INDEX IF NOT EXISTS "expertise_lessons_domain_layer_idx" ON "expertise_lessons" USING btree ("domain_id","layer");
$comhub_sql_0142_expertise_domain_tables_103$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_104$
CREATE INDEX IF NOT EXISTS "expertise_lessons_compiled_criterion_idx" ON "expertise_lessons" USING btree ("compiled_criterion_id");
$comhub_sql_0142_expertise_domain_tables_104$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_105$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_runs_domain_run_index_unique" ON "expertise_runs" USING btree ("domain_id","run_index");
$comhub_sql_0142_expertise_domain_tables_105$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_106$
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_runs_domain_reflection_key_unique" ON "expertise_runs" USING btree ("domain_id","reflection_key") WHERE "expertise_runs"."reflection_key" is not null;
$comhub_sql_0142_expertise_domain_tables_106$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_107$
CREATE INDEX IF NOT EXISTS "expertise_runs_domain_started_idx" ON "expertise_runs" USING btree ("domain_id","started_at");
$comhub_sql_0142_expertise_domain_tables_107$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_108$
CREATE INDEX IF NOT EXISTS "expertise_runs_actor_idx" ON "expertise_runs" USING btree ("actor_type","actor_id");
$comhub_sql_0142_expertise_domain_tables_108$;
    EXECUTE $comhub_sql_0142_expertise_domain_tables_109$
CREATE INDEX IF NOT EXISTS "expertise_runs_subject_idx" ON "expertise_runs" USING btree ("subject_type","subject_id");
$comhub_sql_0142_expertise_domain_tables_109$;
  END IF;
END
$comhub_guard_0142_expertise_domain_tables$;
--> statement-breakpoint

-- Source: 0143_resource_transfer_requests.sql
-- Historical created_at: 1786847279485
DO $comhub_guard_0143_resource_transfer_requests$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786847279485
  ) THEN
    EXECUTE $comhub_sql_0143_resource_transfer_requests_0$
CREATE TABLE IF NOT EXISTS "resource_transfer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"initiator_id" text,
	"recipient_id" text,
	"previous_owner_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"options" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0143_resource_transfer_requests_0$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_1$
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_workspace_id_workspaces_id_fk";
$comhub_sql_0143_resource_transfer_requests_1$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_2$
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0143_resource_transfer_requests_2$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_3$
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_initiator_id_users_id_fk";
$comhub_sql_0143_resource_transfer_requests_3$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_4$
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0143_resource_transfer_requests_4$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_5$
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_recipient_id_users_id_fk";
$comhub_sql_0143_resource_transfer_requests_5$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_6$
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0143_resource_transfer_requests_6$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_7$
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_previous_owner_id_users_id_fk";
$comhub_sql_0143_resource_transfer_requests_7$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_8$
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_previous_owner_id_users_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0143_resource_transfer_requests_8$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_9$
CREATE UNIQUE INDEX IF NOT EXISTS "resource_transfer_requests_pending_resource_unique" ON "resource_transfer_requests" USING btree ("resource_type","resource_id") WHERE "resource_transfer_requests"."status" = 'pending' AND "resource_transfer_requests"."recipient_id" IS NOT NULL;
$comhub_sql_0143_resource_transfer_requests_9$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_10$
CREATE INDEX IF NOT EXISTS "resource_transfer_requests_recipient_idx" ON "resource_transfer_requests" USING btree ("recipient_id","status");
$comhub_sql_0143_resource_transfer_requests_10$;
    EXECUTE $comhub_sql_0143_resource_transfer_requests_11$
CREATE INDEX IF NOT EXISTS "resource_transfer_requests_workspace_idx" ON "resource_transfer_requests" USING btree ("workspace_id");
$comhub_sql_0143_resource_transfer_requests_11$;
  END IF;
END
$comhub_guard_0143_resource_transfer_requests$;
--> statement-breakpoint

-- Source: 0144_notifications_add_metadata_column.sql
-- Historical created_at: 1786968214710
DO $comhub_guard_0144_notifications_add_metadata_column$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1786968214710
  ) THEN
    EXECUTE $comhub_sql_0144_notifications_add_metadata_column_0$
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
$comhub_sql_0144_notifications_add_metadata_column_0$;
  END IF;
END
$comhub_guard_0144_notifications_add_metadata_column$;
--> statement-breakpoint

-- Source: 0145_agents_add_identity_columns.sql
-- Historical created_at: 1787141104502
DO $comhub_guard_0145_agents_add_identity_columns$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1787141104502
  ) THEN
    EXECUTE $comhub_sql_0145_agents_add_identity_columns_0$
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
$comhub_sql_0145_agents_add_identity_columns_0$;
    EXECUTE $comhub_sql_0145_agents_add_identity_columns_1$
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "profile" jsonb;
$comhub_sql_0145_agents_add_identity_columns_1$;
    EXECUTE $comhub_sql_0145_agents_add_identity_columns_2$
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "society_id" text;
$comhub_sql_0145_agents_add_identity_columns_2$;
  END IF;
END
$comhub_guard_0145_agents_add_identity_columns$;
--> statement-breakpoint

-- Source: 0146_acceptance_project_association.sql
-- Historical created_at: 1787188183549
DO $comhub_guard_0146_acceptance_project_association$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1787188183549
  ) THEN
    EXECUTE $comhub_sql_0146_acceptance_project_association_0$
CREATE TABLE IF NOT EXISTS "project_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"work_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0146_acceptance_project_association_0$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_1$
ALTER TABLE "acceptances" ADD COLUMN IF NOT EXISTS "project_id" text;
$comhub_sql_0146_acceptance_project_association_1$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_2$
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_project_id_projects_id_fk";
$comhub_sql_0146_acceptance_project_association_2$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_3$
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0146_acceptance_project_association_3$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_4$
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_work_id_works_id_fk";
$comhub_sql_0146_acceptance_project_association_4$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_5$
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0146_acceptance_project_association_5$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_6$
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_added_by_user_id_users_id_fk";
$comhub_sql_0146_acceptance_project_association_6$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_7$
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0146_acceptance_project_association_7$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_8$
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_workspace_id_workspaces_id_fk";
$comhub_sql_0146_acceptance_project_association_8$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_9$
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0146_acceptance_project_association_9$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_10$
CREATE UNIQUE INDEX IF NOT EXISTS "project_works_project_id_work_id_unique" ON "project_works" USING btree ("project_id","work_id");
$comhub_sql_0146_acceptance_project_association_10$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_11$
CREATE INDEX IF NOT EXISTS "project_works_project_id_sort_order_idx" ON "project_works" USING btree ("project_id","sort_order");
$comhub_sql_0146_acceptance_project_association_11$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_12$
CREATE INDEX IF NOT EXISTS "project_works_work_id_idx" ON "project_works" USING btree ("work_id");
$comhub_sql_0146_acceptance_project_association_12$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_13$
CREATE INDEX IF NOT EXISTS "project_works_workspace_id_idx" ON "project_works" USING btree ("workspace_id");
$comhub_sql_0146_acceptance_project_association_13$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_14$
ALTER TABLE "acceptances" DROP CONSTRAINT IF EXISTS "acceptances_project_id_projects_id_fk";
$comhub_sql_0146_acceptance_project_association_14$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_15$
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0146_acceptance_project_association_15$;
    EXECUTE $comhub_sql_0146_acceptance_project_association_16$
CREATE INDEX IF NOT EXISTS "acceptances_project_id_idx" ON "acceptances" USING btree ("project_id");
$comhub_sql_0146_acceptance_project_association_16$;
  END IF;
END
$comhub_guard_0146_acceptance_project_association$;
--> statement-breakpoint

-- Source: 0147_resource_permissions_per_member_subject.sql
-- Historical created_at: 1787239313202
DO $comhub_guard_0147_resource_permissions_per_member_subject$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1787239313202
  ) THEN
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_0$
DROP INDEX IF EXISTS "resource_permissions_workspace_resource_unique";
$comhub_sql_0147_resource_permissions_per_member_subject_0$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_1$
ALTER TABLE "resource_permissions" ADD COLUMN IF NOT EXISTS "user_id" text;
$comhub_sql_0147_resource_permissions_per_member_subject_1$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_2$
ALTER TABLE "resource_permissions" DROP CONSTRAINT IF EXISTS "resource_permissions_user_id_users_id_fk";
$comhub_sql_0147_resource_permissions_per_member_subject_2$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_3$
ALTER TABLE "resource_permissions" ADD CONSTRAINT "resource_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0147_resource_permissions_per_member_subject_3$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_4$
CREATE UNIQUE INDEX IF NOT EXISTS "resource_permissions_workspace_resource_user_id_unique" ON "resource_permissions" USING btree ("workspace_id","resource_type","resource_id","user_id") WHERE "resource_permissions"."user_id" is not null;
$comhub_sql_0147_resource_permissions_per_member_subject_4$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_5$
CREATE INDEX IF NOT EXISTS "resource_permissions_workspace_user_idx" ON "resource_permissions" USING btree ("workspace_id","user_id");
$comhub_sql_0147_resource_permissions_per_member_subject_5$;
    EXECUTE $comhub_sql_0147_resource_permissions_per_member_subject_6$
CREATE UNIQUE INDEX IF NOT EXISTS "resource_permissions_workspace_resource_unique" ON "resource_permissions" USING btree ("workspace_id","resource_type","resource_id") WHERE "resource_permissions"."user_id" is null;
$comhub_sql_0147_resource_permissions_per_member_subject_6$;
  END IF;
END
$comhub_guard_0147_resource_permissions_per_member_subject$;
--> statement-breakpoint

-- Source: 0148_goal_graph.sql
-- Historical created_at: 1787376421190
DO $comhub_guard_0148_goal_graph$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" = 1787376421190
  ) THEN
    EXECUTE $comhub_sql_0148_goal_graph_0$
CREATE TABLE IF NOT EXISTS "goal_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_edges_distinct_nodes" CHECK ("goal_edges"."source_node_id" <> "goal_edges"."target_node_id")
);
$comhub_sql_0148_goal_graph_0$;
    EXECUTE $comhub_sql_0148_goal_graph_1$
CREATE TABLE IF NOT EXISTS "goal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"task_id" text,
	"operation_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0148_goal_graph_1$;
    EXECUTE $comhub_sql_0148_goal_graph_2$
CREATE TABLE IF NOT EXISTS "goal_node_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"authority" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"question" text NOT NULL,
	"options" jsonb,
	"recommended_option_id" text,
	"requested_user_id" text,
	"requested_project_role" text,
	"resolved_option_id" text,
	"resolution" text,
	"resolved_by_user_id" text,
	"resolved_by_agent_id" text,
	"resolved_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0148_goal_graph_2$;
    EXECUTE $comhub_sql_0148_goal_graph_3$
CREATE TABLE IF NOT EXISTS "goal_node_work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"work_version_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
$comhub_sql_0148_goal_graph_3$;
    EXECUTE $comhub_sql_0148_goal_graph_4$
CREATE TABLE IF NOT EXISTS "goal_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3),
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"resolved_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_nodes_goal_id_id_unique" UNIQUE("goal_id","id"),
	CONSTRAINT "goal_nodes_task_requires_work_kind" CHECK ("goal_nodes"."task_id" IS NULL OR "goal_nodes"."kind" = 'work'),
	CONSTRAINT "goal_nodes_confidence_range" CHECK ("goal_nodes"."confidence" IS NULL OR ("goal_nodes"."confidence" >= 0 AND "goal_nodes"."confidence" <= 1))
);
$comhub_sql_0148_goal_graph_4$;
    EXECUTE $comhub_sql_0148_goal_graph_5$
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'goal_nodes_goal_id_id_unique'
			AND conrelid = 'public.goal_nodes'::regclass
	) THEN
		IF to_regclass('public.goal_nodes_goal_id_id_unique') IS NOT NULL THEN
			ALTER TABLE "goal_nodes"
				ADD CONSTRAINT "goal_nodes_goal_id_id_unique"
				UNIQUE USING INDEX "goal_nodes_goal_id_id_unique";
		ELSE
			ALTER TABLE "goal_nodes"
				ADD CONSTRAINT "goal_nodes_goal_id_id_unique" UNIQUE ("goal_id", "id");
		END IF;
	END IF;
END $$;
$comhub_sql_0148_goal_graph_5$;
    EXECUTE $comhub_sql_0148_goal_graph_6$
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_id_goals_id_fk";
$comhub_sql_0148_goal_graph_6$;
    EXECUTE $comhub_sql_0148_goal_graph_7$
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_7$;
    EXECUTE $comhub_sql_0148_goal_graph_8$
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_source_node_fk";
$comhub_sql_0148_goal_graph_8$;
    EXECUTE $comhub_sql_0148_goal_graph_9$
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_source_node_fk" FOREIGN KEY ("goal_id","source_node_id") REFERENCES "public"."goal_nodes"("goal_id","id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_9$;
    EXECUTE $comhub_sql_0148_goal_graph_10$
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_target_node_fk";
$comhub_sql_0148_goal_graph_10$;
    EXECUTE $comhub_sql_0148_goal_graph_11$
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_target_node_fk" FOREIGN KEY ("goal_id","target_node_id") REFERENCES "public"."goal_nodes"("goal_id","id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_11$;
    EXECUTE $comhub_sql_0148_goal_graph_12$
ALTER TABLE "goal_events" DROP CONSTRAINT IF EXISTS "goal_events_goal_id_goals_id_fk";
$comhub_sql_0148_goal_graph_12$;
    EXECUTE $comhub_sql_0148_goal_graph_13$
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_13$;
    EXECUTE $comhub_sql_0148_goal_graph_14$
ALTER TABLE "goal_events" DROP CONSTRAINT IF EXISTS "goal_events_task_id_tasks_id_fk";
$comhub_sql_0148_goal_graph_14$;
    EXECUTE $comhub_sql_0148_goal_graph_15$
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_15$;
    EXECUTE $comhub_sql_0148_goal_graph_16$
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_node_id_goal_nodes_id_fk";
$comhub_sql_0148_goal_graph_16$;
    EXECUTE $comhub_sql_0148_goal_graph_17$
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_node_id_goal_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."goal_nodes"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_17$;
    EXECUTE $comhub_sql_0148_goal_graph_18$
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_requested_user_id_users_id_fk";
$comhub_sql_0148_goal_graph_18$;
    EXECUTE $comhub_sql_0148_goal_graph_19$
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_requested_user_id_users_id_fk" FOREIGN KEY ("requested_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_19$;
    EXECUTE $comhub_sql_0148_goal_graph_20$
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_resolved_by_user_id_users_id_fk";
$comhub_sql_0148_goal_graph_20$;
    EXECUTE $comhub_sql_0148_goal_graph_21$
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_21$;
    EXECUTE $comhub_sql_0148_goal_graph_22$
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_resolved_by_agent_id_agents_id_fk";
$comhub_sql_0148_goal_graph_22$;
    EXECUTE $comhub_sql_0148_goal_graph_23$
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_23$;
    EXECUTE $comhub_sql_0148_goal_graph_24$
ALTER TABLE "goal_node_work_versions" DROP CONSTRAINT IF EXISTS "goal_node_work_versions_node_id_goal_nodes_id_fk";
$comhub_sql_0148_goal_graph_24$;
    EXECUTE $comhub_sql_0148_goal_graph_25$
ALTER TABLE "goal_node_work_versions" ADD CONSTRAINT "goal_node_work_versions_node_id_goal_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."goal_nodes"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_25$;
    EXECUTE $comhub_sql_0148_goal_graph_26$
ALTER TABLE "goal_node_work_versions" DROP CONSTRAINT IF EXISTS "goal_node_work_versions_work_version_id_work_versions_id_fk";
$comhub_sql_0148_goal_graph_26$;
    EXECUTE $comhub_sql_0148_goal_graph_27$
ALTER TABLE "goal_node_work_versions" ADD CONSTRAINT "goal_node_work_versions_work_version_id_work_versions_id_fk" FOREIGN KEY ("work_version_id") REFERENCES "public"."work_versions"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_27$;
    EXECUTE $comhub_sql_0148_goal_graph_28$
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_goal_id_goals_id_fk";
$comhub_sql_0148_goal_graph_28$;
    EXECUTE $comhub_sql_0148_goal_graph_29$
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
$comhub_sql_0148_goal_graph_29$;
    EXECUTE $comhub_sql_0148_goal_graph_30$
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_task_id_tasks_id_fk";
$comhub_sql_0148_goal_graph_30$;
    EXECUTE $comhub_sql_0148_goal_graph_31$
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_31$;
    EXECUTE $comhub_sql_0148_goal_graph_32$
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_created_by_user_id_users_id_fk";
$comhub_sql_0148_goal_graph_32$;
    EXECUTE $comhub_sql_0148_goal_graph_33$
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_33$;
    EXECUTE $comhub_sql_0148_goal_graph_34$
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_created_by_agent_id_agents_id_fk";
$comhub_sql_0148_goal_graph_34$;
    EXECUTE $comhub_sql_0148_goal_graph_35$
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
$comhub_sql_0148_goal_graph_35$;
    EXECUTE $comhub_sql_0148_goal_graph_36$
CREATE UNIQUE INDEX IF NOT EXISTS "goal_edges_source_target_kind_unique" ON "goal_edges" USING btree ("source_node_id","target_node_id","kind");
$comhub_sql_0148_goal_graph_36$;
    EXECUTE $comhub_sql_0148_goal_graph_37$
CREATE INDEX IF NOT EXISTS "goal_edges_goal_id_idx" ON "goal_edges" USING btree ("goal_id");
$comhub_sql_0148_goal_graph_37$;
    EXECUTE $comhub_sql_0148_goal_graph_38$
CREATE INDEX IF NOT EXISTS "goal_edges_target_node_id_idx" ON "goal_edges" USING btree ("target_node_id");
$comhub_sql_0148_goal_graph_38$;
    EXECUTE $comhub_sql_0148_goal_graph_39$
CREATE INDEX IF NOT EXISTS "goal_events_goal_id_created_at_idx" ON "goal_events" USING btree ("goal_id","created_at");
$comhub_sql_0148_goal_graph_39$;
    EXECUTE $comhub_sql_0148_goal_graph_40$
CREATE INDEX IF NOT EXISTS "goal_events_entity_idx" ON "goal_events" USING btree ("entity_type","entity_id");
$comhub_sql_0148_goal_graph_40$;
    EXECUTE $comhub_sql_0148_goal_graph_41$
CREATE INDEX IF NOT EXISTS "goal_events_task_id_idx" ON "goal_events" USING btree ("task_id");
$comhub_sql_0148_goal_graph_41$;
    EXECUTE $comhub_sql_0148_goal_graph_42$
CREATE INDEX IF NOT EXISTS "goal_events_operation_id_idx" ON "goal_events" USING btree ("operation_id");
$comhub_sql_0148_goal_graph_42$;
    EXECUTE $comhub_sql_0148_goal_graph_43$
CREATE UNIQUE INDEX IF NOT EXISTS "goal_node_decisions_node_id_unique" ON "goal_node_decisions" USING btree ("node_id");
$comhub_sql_0148_goal_graph_43$;
    EXECUTE $comhub_sql_0148_goal_graph_44$
CREATE INDEX IF NOT EXISTS "goal_node_decisions_status_idx" ON "goal_node_decisions" USING btree ("status");
$comhub_sql_0148_goal_graph_44$;
    EXECUTE $comhub_sql_0148_goal_graph_45$
CREATE INDEX IF NOT EXISTS "goal_node_decisions_requested_user_id_status_idx" ON "goal_node_decisions" USING btree ("requested_user_id","status");
$comhub_sql_0148_goal_graph_45$;
    EXECUTE $comhub_sql_0148_goal_graph_46$
CREATE UNIQUE INDEX IF NOT EXISTS "goal_node_work_versions_node_version_relation_unique" ON "goal_node_work_versions" USING btree ("node_id","work_version_id","relation");
$comhub_sql_0148_goal_graph_46$;
    EXECUTE $comhub_sql_0148_goal_graph_47$
CREATE INDEX IF NOT EXISTS "goal_node_work_versions_work_version_id_idx" ON "goal_node_work_versions" USING btree ("work_version_id");
$comhub_sql_0148_goal_graph_47$;
    EXECUTE $comhub_sql_0148_goal_graph_48$
CREATE INDEX IF NOT EXISTS "goal_nodes_goal_id_status_idx" ON "goal_nodes" USING btree ("goal_id","status");
$comhub_sql_0148_goal_graph_48$;
    EXECUTE $comhub_sql_0148_goal_graph_49$
CREATE INDEX IF NOT EXISTS "goal_nodes_goal_id_kind_idx" ON "goal_nodes" USING btree ("goal_id","kind");
$comhub_sql_0148_goal_graph_49$;
    EXECUTE $comhub_sql_0148_goal_graph_50$
CREATE UNIQUE INDEX IF NOT EXISTS "goal_nodes_task_id_unique" ON "goal_nodes" USING btree ("task_id") WHERE "goal_nodes"."task_id" is not null;
$comhub_sql_0148_goal_graph_50$;
  END IF;
END
$comhub_guard_0148_goal_graph$;
--> statement-breakpoint
