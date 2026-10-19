CREATE INDEX IF NOT EXISTS "topics_user_agent_updated_at_idx"
  ON "topics" ("user_id", "agent_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_user_group_updated_at_idx"
  ON "topics" ("user_id", "group_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_workspace_agent_updated_at_idx"
  ON "topics" ("workspace_id", "agent_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_workspace_group_updated_at_idx"
  ON "topics" ("workspace_id", "group_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_topic_user_updated_at_idx"
  ON "messages" ("topic_id", "user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_topic_workspace_updated_at_idx"
  ON "messages" ("topic_id", "workspace_id", "updated_at");
