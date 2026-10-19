# Contributing to ComHub

ComHub is maintained as an independent customization based on LobeHub. We
welcome focused contributions that improve the product without weakening its
security, deployment, or upstream-sync boundaries.

## Start a Contribution

1. Fork `maheshenga/comhub` and clone your fork.
2. Create a focused branch from `main`.
3. Make one scoped change with its tests and documentation.
4. Open a pull request targeting `main`.

```bash
git clone https://github.com/maheshenga/comhub.git
cd comhub
git checkout -b feat/short-description
pnpm install --no-frozen-lockfile
node --test .github/workflows/comhubDeploymentWorkflows.test.mjs
bun run type-check
```

## Pull Requests

- Keep each pull request focused and describe its user-facing or operational
  impact.
- Include focused tests for changed behavior. The repository's PR checks must
  pass before merge.
- Do not commit credentials, production data, private host names, or generated
  deployment artifacts.
- Production and Worker deployment remain manually dispatched after review;
  opening or merging a pull request never deploys a service.

## Upstream Sync

ComHub retains LobeHub as an `upstream` remote. Upstream releases are evaluated
through the repository's sync workflow and review branches. Do not merge a
large upstream update directly into an unrelated feature pull request.

## Reporting Problems

Use GitHub Issues for reproducible defects and feature requests. Report
security issues privately as described in [SECURITY.md](SECURITY.md).
