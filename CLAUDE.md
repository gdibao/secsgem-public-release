@AGENTS.md

# ComHub AI Development Governance

These rules apply to all AI-assisted work in this LobeHub-derived ComHub project.
They are mandatory unless the user explicitly overrides them for a specific task.

## Required Context Before Code Changes

Before modifying any business code, routing, configuration, database schema,
deployment file, or UI behavior, read these documents first:

- `docs/FEATURE_REGISTRY.md`
- `docs/PROJECT_AUDIT.md`
- `docs/REFACTOR_PLAN.md`

Use those files to identify the affected feature, current status, risk level,
dependencies, and recommended refactor path. If the affected feature is missing
from the registry, add or update the registry entry before completing the task.

## Feature Change Governance

When adding a new feature:

- Update `docs/FEATURE_REGISTRY.md`.
- Update `docs/CHANGELOG_INTERNAL.md`; create it if it does not exist.
- Record the feature status, entry points, API/server actions, database/config
  dependencies, environment variables, external services, risk level, and test
  coverage.

When modifying an existing feature, the final response or change notes must
state the impact scope for:

- Pages
- Components
- API / Server Actions
- Database
- Configuration keys
- Environment variables
- Docker deployment

When deleting a feature:

- Mark it as `deprecated` in `docs/FEATURE_REGISTRY.md` first.
- Check all references with code search and route/API registration search.
- Confirm there are no active dependencies, migrations, runtime config users,
  deployment references, or user-facing entry points.
- Only then delete code in a small, reversible change.

## Refactor Governance

- Do not perform unplanned large-scale refactors.
- Follow `docs/REFACTOR_PLAN.md` and split work into small reversible steps.
- Core flows must have tests before refactoring.
- Keep old behavior behind an adapter, formatter, feature flag, or compatibility
  route until the replacement is verified.
- Prefer one refactor item per PR or commit series.

Core flows include:

- Admin settings and runtime config
- AI provider/model catalog
- Model pricing and billing
- Plans, credits, usage, billing, and referral pages
- Brand/loading/favicon/default-agent behavior
- Desktop update and deployment pipeline
- Notification, memory, Composio, and community/MCP flows
- Auth, user profile, user defaults, and permission-sensitive admin actions

## AI Configuration Rules

Never hardcode AI credentials or model routing values in source code, tests,
Docker files, or documentation examples intended for deployment.

Do not hardcode:

- AI API keys
- AI base URLs
- AI model names

AI-related runtime configuration must come from environment variables:

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL_NAME`

If a provider-specific variable is required for backward compatibility, it must
be mapped through the approved settings/config layer and documented in the
feature registry. Do not introduce new provider-specific hardcoded fallbacks.

## Docker Deployment Rules

- Docker deployment must use Bind Mounts.
- Do not introduce Docker Named Volumes.
- Deployment changes must describe the affected bind-mounted host paths,
  container paths, migration impact, rollback path, and whether existing data is
  read, written, or migrated.

## Review Checklist For AI Agents

Before claiming completion:

- Verify only intended files changed.
- Confirm `docs/FEATURE_REGISTRY.md` is updated for added/deleted feature scope.
- Confirm `docs/CHANGELOG_INTERNAL.md` is updated for new features.
- Confirm impact scope is documented for existing feature changes.
- Confirm no AI key, base URL, or model name was hardcoded.
- Confirm Docker changes use Bind Mounts only.
- Confirm P0/P1/core-flow refactors have tests or documented smoke checks.
- Confirm the change is reversible.
