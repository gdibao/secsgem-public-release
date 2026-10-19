-- Remove obsolete single-instance NewAPI settings after the 0112 migration has
-- copied them into admin_newapi_instances/admin_newapi_instance_models.
DELETE FROM "app_settings"
WHERE key IN ('newapi.apiKey', 'newapi.proxyUrl', 'newapi.enabledModels');
