ALTER TABLE IF EXISTS "desktop_releases" ADD COLUMN IF NOT EXISTS "published_download_url" varchar(2048);--> statement-breakpoint
ALTER TABLE IF EXISTS "desktop_releases" ADD COLUMN IF NOT EXISTS "published_server_url" varchar(2048);
