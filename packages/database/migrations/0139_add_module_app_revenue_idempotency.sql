CREATE UNIQUE INDEX IF NOT EXISTS "module_app_revenue_entries_order_type_unique"
  ON "module_app_revenue_entries" ("order_id", "type");
