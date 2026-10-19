# FAB deployment handoff

Status: RELEASE APPROVED on 2026-09-20. Independent infrastructure and controlled
four-service restart acceptance passed; publication is pending a verified remote
commit. Owner/business acceptance remains separate.
Do not modify unrelated deployments or reuse their databases or credentials.
Git destination: https://github.com/CT-Claw/fab ONLY. Real `.env`, `.tls`, logs
and volumes must never enter Git. This is a sanitized handoff, not a full host
backup or an automated infrastructure installer.

## C125-04R runtime status (2026-09-20, base deployment complete)

The deployment worker reports that image-transfer recovery completed, original
image digests were imported/associated, and all 185 migration hashes and timestamps
matched. Independent verification then confirmed four healthy services, all 185
migration hashes/timestamps, canonical signed S3 checks and data persistence across
a controlled whole-stack Compose restart. All 41 script/stylesheet/preload URLs
discovered by the verifier were fetched successfully (39 JavaScript, two CSS),
with the correct public origin. This is HTTP verification, not visual browser or
JavaScript-interaction acceptance. See the sanitized publication report
at ../../docs/report-comhub-125-git-publish-20260920.md. Internal transfer records,
host inventories, SSH trust data and operational reports are deliberately omitted.
The initialization section below is a fresh-install runbook, NOT a command to
reinitialize the already deployed .125 volumes or replace its existing .env.

The dedicated direct-SSH tunnel is already active and enabled on .125, with VPS
loopback :41825 -> .125 :3210 and :41826 -> .125 :19000. Direct SSH was tested;
an application proxy is separate from this SSH transport. A restricted tunnel
account and fab-only TLS/S3 Nginx routing are installed.
Public /api/version returns 200 with the selected full source SHA, valid TLS.
The same-origin signin page and all 41 verifier-selected assets return 200. Signup is disabled;
no owner/account has been fabricated and no live business flow is claimed.

Independent checks also confirmed the prior four-site routing/TLS baseline and
all 22 pre-existing vhost configuration hashes unchanged. During simultaneous
Compose restart, the application encountered PostgreSQL not yet accepting
connections and automatically retried once before becoming healthy. This recovered
startup-order warning is retained, not hidden; restart policy is not proof of
zero-retry boot ordering. Whole-host reboot was not attempted because an existing
console session could not safely be interrupted. Browser rendering/interaction,
real owner login, user-session persistence, business integrations, long-duration
stability and power-loss durability remain untested. Database and S3 persistence
passed across the controlled stack restart; Redis AOF status was checked, not a
real user session. No live configuration was changed by the publication track.

Current Compose defaults to FOUR services. storage-tls is disabled behind the
local-tls profile. The accepted route uses APP_PROXY_URL set locally to the
operator-verified credential-free LAN proxy and the public canonical S3 endpoint;
extra_hosts maps fab to its verified VPS IP to avoid unreliable external DNS.
The public template intentionally leaves APP_PROXY_URL and FAB_PUBLIC_IP blank.
Set them privately for a fresh installation before Compose validation. This
sanitization has not changed the existing deployed configuration or its secrets.
Signed S3 PUT/GET/DELETE and unsigned GET denial passed internally, through the
app proxy/canonical endpoint and from an independent external client, including
after tunnel restart. No certificate/private key was
copied to .125. The historical local-TLS design below is a fallback only: activating
it also requires removing the public-IP extra_hosts override and implementing a
verified domain-only certificate renewal delivery procedure, not a one-time copy.

After migration, the four-service start/check sequence is:

```sh
docker compose up -d --wait --wait-timeout 300 comhub
docker compose exec -T comhub /bin/node /ops/storage.cjs check-internal
docker compose exec -T comhub /bin/proxychains -q /bin/node /ops/storage.cjs check
```

The second check explicitly applies the same upstream proxychains transport as
the app launcher; docker exec does not inherit the launcher's LD_PRELOAD. A second
external-client signed PUT/GET/DELETE check remains mandatory. No scripts here are
scheduled or automatically retried. Infrastructure recovery scripts are not part
of this public package.

## Source and image gate

On 2026-09-20 both CT-Claw/fab HEAD and maheshenga/comhub HEAD were exactly
`1e63fcd11cf4b2043f01cfa13337dbb0094c4f8b`, tree
`71000b1fb8c12e22353186dae7aa5df96d794c0b` at the initial source checkpoint.
See source-evidence.json. The upstream main image config embeds this full commit,
and the deployment worker verified it at runtime. Business source was neither
edited nor compiled for this deployment: it uses the upstream published image.
The initial fork HEAD is a historical baseline, not a claim about future HEADs.

Default image:
`ghcr.io/maheshenga/comhub@sha256:9701ef9da5a5e5606c89196a81b4e1206136c804a6c38be3fb186c219d69bbff`.
Its runnable child is linux/amd64. Unknown/unknown index entries are attestations,
not additional CPU architectures. Do NOT silently emulate ARM or substitute
`lobehub/lobehub`, `latest`, a different commit, or an unverified mirror image.

Before rollout, recheck the fork HEAD. If it has changed, stop automatic reuse:
the integration/build track must review the differences (including build inputs)
or build the selected fork commit. Never reset the user's fork to match upstream.
Adding these deployment artifacts later does not mean the upstream image embeds
the new Git integration commit; record source baseline and packaging commit separately.

## Minimal services and storage

- comhub: immutable published image, localhost:3210 only; no local model server.
- postgresql: upstream production-pinned ParadeDB digest, PG **18**, not PG17.
  Image config PGDATA=/var/lib/postgresql/18/docker; mount /var/lib/postgresql.
  Both `vector` and `pg_search` must pass preflight and migration verification.
- redis: private authenticated cache, AOF, no host port.
- rustfs: private single bucket, persistent data/logs, console disabled;
  localhost:19000 -> S3:9000 for the dedicated VPS tunnel only.
- storage-tls: OPTIONAL local-tls profile, inactive in the four-service route.
  Activating this alternative requires separately implementing certificate renewal.

No external networks/volumes, no NewAPI/Casdoor connection, no OnlyBoxes connection,
no QStash token, no search service, no module runtime/worker, no payment credentials.
All configured production experiment/payment mutation flags are explicitly false.
Embedding/metadata auto-generation is off until separately configured and accepted.
Built-in remote market and other optional online features are NOT made local here.
No business integrations have been configured or accepted for this deployment.
Enabling them requires owner configuration and separate end-to-end acceptance;
this does not claim that every upstream outbound feature is disabled by default.

Planning floor: amd64, 4 vCPU, 8 GiB RAM, 80 GiB free SSD. Prefer 8 vCPU/16 GiB
and expandable 100+ GiB storage. These are engineering estimates, NOT measured
minimums or a concurrency promise. Allow storage growth for attachments/backups.

## Address and ingress contract

PUBLIC `APP_URL=https://fab.gdibao.com` (runtime environment, not a custom
`PUBLIC_APP_URL` or `NEXT_PUBLIC_APP_URL`). `INTERNAL_APP_URL=http://127.0.0.1:3210`.
PG=postgresql:5432; Redis=redis:6379; bucket initialization=http://rustfs:9000.

The actual source has ONE S3 endpoint for server operations and browser presigning.
`S3_PUBLIC_DOMAIN` is not a separate upload endpoint. Therefore:

1. `S3_ENDPOINT=https://fab.gdibao.com`, bucket=comhub-files, path-style=1.
2. Public VPS HTTPS `/comhub-files` and `/comhub-files/...` route unchanged through
   a SECOND loopback SSH reverse forward to .125 localhost:19000. Preserve Host,
   complete path, query, method and body; no rewrite/strip-prefix/redirect. All
   other routes go to the app forward targeting .125 localhost:3210.
3. In the default four-service route, comhub maps fab.gdibao.com to the VPS public
   address. The upstream application launcher uses the verified credential-free
   LAN proxy for external requests; PG/Redis/RustFS remain direct internal traffic.
   Canonical S3 requests go through the existing VPS HTTPS/S3 tunnel path.
4. No certificate/private key is copied to .125. TLS terminates on the VPS with
   its existing tested Certbot renewal hook. The local-tls profile is an inactive
   alternative, not an additional default service. Never disable TLS validation.
5. No new storage DNS record is needed. Same-origin uploads avoid CORS ambiguity.
   No anonymous bucket policy, no public-read ACL, no S3 administration at ingress.

VPS snippet: nginx-vps-locations.conf.example. For this deployment the app and S3
loopback ports are 41825 and 41826 respectively; replace the example placeholders
only after verifying reservations. The public VPS terminates browser TLS; local
TLS remains inactive. SSE buffering is disabled.
The 100 MiB upload limit must be aligned with product settings and available space.
Do not log presigned query strings. No external HTTP health success substitutes for
signed browser upload/download checks. Do not open the site until both routes work.

## Proxy separation (operator supplies private settings)

.125 has no direct Internet. Do not assume changing apt mirrors fixes Docker.

- Docker daemon pull proxy: C125-01 configures the actual verified LAN proxy in
  Docker's systemd service or daemon proxy configuration and restarts Docker in
  its own maintenance window. Shell HTTP_PROXY is not sufficient for image pulls.
  Keep localhost, loopback, .125/LAN tunnel targets and any internal registry in
  daemon NO_PROXY. Never set an Internet registry to bypass a required proxy.
- BuildKit: a separate builder needs its own verified network/proxy configuration;
  build RUN steps and base image resolution have different proxy scopes. No PAT
  or proxy credential may be passed as an ordinary image build argument.
- Application: APP_PROXY_URL maps to upstream PROXY_URL (http/socks4/socks5).
  Supply an operator-verified container-reachable address. Host localhost
  is NOT another VM's proxy. This launcher uses proxychains, not just HTTP_PROXY.
  Its source excludes 127/8, 10/8, 172.16/12 and 192.168/16. Keep Docker network
  addresses within those ranges and ENABLE_PROXY_DNS=0 to preserve local DNS.
- NO_PROXY/no_proxy explicitly include PG/Redis/RustFS/local TLS/app/loopback.
  NO_PROXY alone does not control proxychains; the source localnet rules above do.
  SSH tunnels remain direct LAN/VPS SSH transport, not an application HTTP proxy.
- IMPORTANT: upstream startServer.js logs the entire PROXY_URL. Supply only a
  credential-free LAN proxy URL. If authentication is required, bootstrap must
  provide a protected credential-free local relay; do not expose credentials in logs.

No guessed proxy address, insecure registry, PAT, or TLS bypass is provided.

## Fresh-install runbook (do not repeat on existing volumes)

Work in the .125 directory containing this README. Docker Compose is required.
First confirm architecture, disk, daemon proxy, two ingress forward ports and
valid VPS TLS. Keep fab ingress IP-restricted/maintenance-only throughout
owner setup. Pull the pinned main image explicitly before generating .env.
After generation, privately set FAB_PUBLIC_IP and, when needed, APP_PROXY_URL.
The intentionally blank public template is not ready for an unattended rollout:

```sh
IMAGE=ghcr.io/maheshenga/comhub@sha256:9701ef9da5a5e5606c89196a81b4e1206136c804a6c38be3fb186c219d69bbff
docker pull --platform linux/amd64 "$IMAGE"
docker run --rm --network none --entrypoint /bin/node \
  --user "$(id -u):$(id -g)" --workdir /work \
  --mount "type=bind,src=$PWD,dst=/work" "$IMAGE" /work/ops/init-env.mjs
# STOP: privately configure FAB_PUBLIC_IP and APP_PROXY_URL in .env first.
docker compose config --quiet
docker compose pull
docker compose up -d --wait --wait-timeout 180 postgresql redis rustfs
docker compose run --rm --no-deps --entrypoint /bin/node comhub /ops/check-db.cjs preflight
docker compose run --rm --no-deps --entrypoint /bin/node comhub /ops/storage.cjs init
docker compose run --rm --no-deps --entrypoint /bin/node comhub /app/docker.cjs
docker compose run --rm --no-deps --entrypoint /bin/node comhub /ops/check-db.cjs
docker compose up -d --wait --wait-timeout 300 comhub
docker compose exec -T comhub /bin/node /ops/storage.cjs check-internal
docker compose exec -T comhub /bin/proxychains -q /bin/node /ops/storage.cjs check
curl --fail --silent --show-error http://127.0.0.1:3210/api/version
docker compose ps
```

Stop on ANY failing step; do not continue the list blindly. The launcher also runs
`/app/docker.cjs` at each normal startup before `/app/server.js`. This is intentional;
the explicit first migration provides a separate failure gate. Use a single app
instance/migrator during initialization. Never disable migrations to force health.
The source journal has 185 unique entries but two timestamp regressions. The helper
checks ALL SQL hashes/timestamps against drizzle.__drizzle_migrations, not just the
last migration or a success message. Never manually forge migration ledger rows.

Ops helpers reuse the image's bundled pg, AWS S3 client and Smithy SignatureV4.
The image does not contain s3-request-presigner; the maintenance signing adapter
uses the bundled signer and restricts calls to deployment-check objects. These
helpers have passed on .125. Do not install workspace dependencies into the image.
Keep ParadeDB's default preload settings: overriding with pg_search alone breaks
its pg_cron bootstrap. The current Compose intentionally has no such override.

## Owner bootstrap and registration lock

This source exposes scripts/promoteAdmin.ts, which updates an existing user's
role to `admin`. Inspected auth/bootstrap paths do NOT establish a first-user-wins
admin mechanism. Nevertheless public registration must remain locked to prevent
owner email squatting and unauthorized accounts before setup.

Defaults disable email/password login AND signup, disable SSO and magic link;
there is no fabricated admin account/password. To bootstrap the real owner:

1. Keep the entire public vhost restricted to the owner's verified access path.
   `AUTH_ALLOWED_EMAILS` alone is NOT proof of email ownership without verification.
2. Set AUTH_ALLOWED_EMAILS to the exact real owner email (not a broad domain).
   Set AUTH_DISABLE_EMAIL_PASSWORD=0 and recreate only comhub. With no SMTP this
   is a protected bootstrap-only session, not verified public email authentication.
3. Owner registers their real account and chooses their password through the UI.
   Deployment operator verifies the resulting user ID against that owner, then:

```sh
# Set ADMIN_USER_ID to the verified real account ID, never a guessed/test value.
docker compose exec -T -e ADMIN_USER_ID="$ADMIN_USER_ID" comhub \
  /bin/node /ops/promote-admin.cjs
```

4. Confirm fresh login and admin access. The helper refuses a second different
   administrator and never creates users. Record who approved and performed it.
5. Keep the exact-email whitelist for owner-only acceptance. Public signup is a
   separate release gate: configure/test SMTP and AUTH_EMAIL_VERIFICATION=1 before
   widening access; this template intentionally supplies no SMTP/payment/OAuth keys.
   AUTH_DISABLE_EMAIL_PASSWORD=1 also disables owner password login, so it is not
   a signup-only switch. Do not flip it casually after owner bootstrap.

## Acceptance and rollback boundaries

- Confirm image digest and /api/version full source SHA, container health/restarts.
- PG extensions + all 185 migration hashes pass, Redis PING, private S3 signed
  PUT/GET/delete pass via canonical HTTPS and anonymous GET remains denied.
- From a real browser on the PUBLIC path: static assets/login redirects use fab;
  upload a harmless file, preview and delete it; check no rustfs:9000/private URL
  reaches the browser. The internal storage helper does not test the VPS path.
- No PG/Redis/console LAN listener; only loopback app/S3 ports. Check dedicated
  VPS listeners remain loopback and existing sites unchanged (C125-02/05).
- After controlled stack/host restart, verify volumes, migration ledger, TLS
  renewal path, tunnel supervision and user session behavior (C125-05).
- Model response, RAG, OAuth/email delivery, payment, market independence and
  sandbox/multi-agent execution are NOT acceptance claims for this packaging task.
- Before any later upgrade, snapshot DB and S3 together with encrypted secrets
  and image references. `docker compose stop` preserves volumes. Never use
  `down -v`, global prune, old-platform DB rollback, or downgrade across migrations
  without a verified backup restoration plan.

## Clean fork build fallback (only when reuse gate fails)

Do not build inside the old platform workspace or modify business code. In a NEW
empty build directory, clone https://github.com/CT-Claw/fab, fetch the selected full
commit, check out detached there, and verify its identity. Build context is the
repository ROOT and Dockerfile is ROOT/Dockerfile (not docker-compose/deploy).

```sh
# SOURCE_SHA must be the reviewed full fork commit, BUILD_DIR a new empty path.
git clone --no-checkout https://github.com/CT-Claw/fab.git "$BUILD_DIR"
git -C "$BUILD_DIR" checkout --detach "$SOURCE_SHA"
test "$(git -C "$BUILD_DIR" rev-parse HEAD)" = "$SOURCE_SHA"
TAG="sha-$(printf '%s' "$SOURCE_SHA" | cut -c1-12)"
BUILD_AT="$(git -C "$BUILD_DIR" show -s --format=%cI "$SOURCE_SHA")"
docker buildx build --platform linux/amd64 --load \
  --file "$BUILD_DIR/Dockerfile" --tag "fab:$TAG" \
  --build-arg NODEJS_VERSION=24.18.0 --build-arg USE_CN_MIRROR=true \
  --build-arg COMHUB_COMMIT_SHA="$SOURCE_SHA" \
  --build-arg COMHUB_BUILD_BRANCH=main --build-arg COMHUB_BUILD_AT="$BUILD_AT" \
  --build-arg COMHUB_IMAGE_TAG="$TAG" --build-arg COMHUB_IMAGE_REF="fab:$TAG" \
  "$BUILD_DIR"
```

The fixed Dockerfile installs dependencies inside build stages and builds the SDK
then the main app. It uses mutable base/dependency resolution; a fixed Git commit
alone is NOT a reproducible binary guarantee. Record build logs/base digests and
resulting artifact digest. Publish only to the authorized fork registry through
the build/integration track, then pin the new immutable digest. Do not pretend a
local `fab:$TAG` is the upstream digest. No PAT in build args, files or reports.
Optional images, if later approved: root context with
apps/module-runtime/Dockerfile and apps/module-worker/Dockerfile. Not built here.
Estimate a cold main build at 30-120 minutes on 8 vCPU/16+ GiB with working mirrors,
60+ GiB temporary disk; network failures can dominate. Not benchmarked on .125.

License remains unresolved: same-commit README says MIT while LICENSE contains
LobeHub Community License. This deployment preparation is not licensing clearance.
