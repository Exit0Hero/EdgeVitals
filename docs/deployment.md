# Deployment

Free Render staging setup (Blueprint, one-time migration, limits): [render-staging.md](render-staging.md).

EdgeVitals ships as three deployables:

| Piece         | Artifact                                          | Where it runs                                                            |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| API           | `apps/api/Dockerfile` → container on port 4000    | Any container platform, behind HTTPS                                     |
| Database      | PostgreSQL 16                                     | Managed Postgres (encrypted at rest, backups)                            |
| Web app       | `apps/mobile/Dockerfile.web` → nginx on port 8080 | Container platform, or the `dist/` folder on a CDN with the same headers |
| iOS / Android | EAS builds (`apps/mobile/eas.json`)               | App Store / Play Store (see the native camera PR)                        |

The product is wellness software. Nothing in this setup makes it a medical device, and the
launch checklist below includes the non-technical items that gate a public release.

## 1. Environment variables

### API (runtime secrets: set in the platform's secret store, never in the image)

| Variable                  | Required | Notes                                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | yes      | `postgres://user:pass@host:5432/db`. Use TLS (`?sslmode=require`) to managed databases.    |
| `JWT_SECRET`              | yes      | ≥ 32 random characters (`openssl rand -base64 48`). Rotating it signs everyone out.        |
| `NODE_ENV`                | yes      | `production`. Enables the strict checks below and `trustProxy`.                            |
| `HOSTING_REGION`          | prod     | Verified hosting region shown on the consent screen. Startup fails if empty in production. |
| `CORS_ORIGINS`            | yes      | Comma-separated web origins. In production they must be explicit `https://` origins.       |
| `DEMO_MODE_ENABLED`       | no       | Must be `false` in production (startup fails otherwise).                                   |
| `AUTH_RATE_LIMIT_PER_MIN` | no       | Per-IP limit on auth endpoints, default 10.                                                |
| `MIGRATE_ON_START`        | no       | Default `true`. Set `false` when the release job below runs migrations.                    |
| `PORT`, `HOST`            | no       | Default `4000`, `0.0.0.0`.                                                                 |

`apps/api/.env.example` documents the same set for local development.

### Web and mobile (build time, public)

| Variable              | Where         | Notes                                                                                                        |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL` | build arg     | API base URL compiled into the bundle. **Public**: never put a secret in any `EXPO_PUBLIC_*` value.          |
| `API_ORIGIN`          | web container | Same API origin, used in the CSP `connect-src`. If it differs from the build arg, every API call is blocked. |

## 2. Database and migrations

- Migrations are plain SQL files in `apps/api/migrations/`, applied in filename order, each in
  its own transaction, and recorded with a checksum in `schema_migrations`. Editing an applied
  file is refused: add a new numbered file instead.
- A Postgres advisory lock serialises concurrent runs, so two replicas starting together are safe.
- **Recommended release flow:** run the image once as a release job with the new version, then
  roll out the API with `MIGRATE_ON_START=false`:

  ```sh
  docker run --rm -e DATABASE_URL=… edgevitals-api node dist/migrate.js
  ```

  It exits non-zero on failure, so the platform stops the rollout.

- Write migrations to be backward compatible with the previous API version (add columns
  nullable, backfill, then tighten in a later release). There are no down migrations: roll
  back by deploying a forward fix.
- Backups: enable daily automated backups with point-in-time recovery, encrypted, and retention
  matching the privacy policy (account deletion removes live data immediately; backups age out
  on their schedule, which the deletion response tells the user).

## 3. Building the images

From the repository root:

```sh
docker build -f apps/api/Dockerfile -t edgevitals-api .
docker build -f apps/mobile/Dockerfile.web \
  --build-arg EXPO_PUBLIC_API_URL=https://api.example.com -t edgevitals-web .
```

- The API image bundles the server with esbuild (`npm run build -w @edgevitals/api`), keeps only
  the native Argon2 addon from `node_modules`, and runs as the unprivileged `node` user.
- The web image exports the Expo web build and serves it from unprivileged nginx.
- Behind a TLS-intercepting proxy, pass its CA as a build secret (it is not stored in a layer):
  `--secret id=npm_ca,src=/path/to/ca.pem`.
- For reproducible builds, pin `NODE_IMAGE` / `NGINX_IMAGE` build args to digests.

## 4. Running

- **Probes:** `GET /health` is liveness (process up). `GET /ready` returns 503 when the database is
  unreachable (`db_unavailable`) or when migrations in this build are not applied yet
  (`migrations_pending`); use it for readiness and load-balancer health checks.
  Both images declare a Docker `HEALTHCHECK`.
- **Shutdown:** on `SIGTERM` the API stops accepting connections, finishes in-flight requests and
  exits within 10 seconds. Give the platform a termination grace period of at least 15 seconds.
- **TLS:** terminate HTTPS at the load balancer or ingress. The API trusts `X-Forwarded-*` in
  production for client IPs (rate limiting and lockout), so it must only be reachable through
  that proxy.
- **Logs:** JSON on stdout. Authorization headers, cookies and request/response bodies are
  redacted, so health data does not reach logs. Keep it that way when adding log lines.
- **Scaling:** the API is stateless; run two or more replicas. Rate-limit counters are per
  replica (in memory). If you run many replicas, move them to Redis (`@fastify/rate-limit`
  supports it). Login lockout is stored in Postgres and is shared across replicas.

### Web hosting headers

`apps/mobile/deploy/security-headers.inc.template` is the single source of the web app's
security headers, including the Content-Security-Policy:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${API_ORIGIN};
media-src 'self' blob: mediastream:; worker-src 'self' blob:; object-src 'none';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- No `unsafe-eval` and no inline scripts. `wasm-unsafe-eval` is needed for the on-device
  MediaPipe face detector. `style-src 'unsafe-inline'` is needed by react-native-web, which
  injects styles at runtime.
- The e2e static server reads the same file, so the Playwright suite runs under this policy and
  fails on any CSP violation during a scan.
- If you host `dist/` on a CDN instead of the nginx image, copy these headers to the CDN and
  serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm`. Cache `/_expo/static/*`
  as immutable and `index.html` as `no-cache`.

## 5. Local production-like stack

```sh
cp deploy.env.example deploy.env   # fill in the values; deploy.env is gitignored
docker compose --env-file deploy.env up --build
```

This starts Postgres, runs the migration job, then starts the API (`:4000`) and web app
(`:8080`). Production mode requires https origins, so for a plain-HTTP smoke test on your
machine set `NODE_ENV=staging` and use `http://localhost` URLs in `deploy.env`. Use a managed
Postgres rather than the compose `db` service in production.

## 6. CI

`.github/workflows/ci.yml` runs on every pull request:

1. `checks`: format, typecheck and all unit/integration tests (with Postgres).
2. `images`: builds both images, runs the migration job and checks `/ready` on the API image,
   and checks the web image's CSP and module MIME types.
3. `e2e`: exports the web build, starts the API (demo mode on, CI only) and runs the Playwright
   suite, including the axe accessibility checks where present.

Publishing images and deploying is intentionally not automated yet: it depends on the hosting
provider, which hasn't been chosen. Add a push-to-registry job once it has.

## 7. Mobile release builds

`apps/mobile/eas.json` defines `development`, `preview` and `production` profiles. Set
`EXPO_PUBLIC_API_URL` per profile to the real API URL before building. Store signing
credentials in EAS, never in the repository. Native camera support must pass the device test
plan (`docs/native-camera-device-tests.md`) before a store release.

## 8. Launch checklist

- [ ] Managed Postgres with TLS, encryption at rest, PITR backups; `HOSTING_REGION` verified.
- [ ] Secrets in the platform's secret store; `JWT_SECRET` generated fresh for production.
- [ ] `NODE_ENV=production`, `DEMO_MODE_ENABLED=false`, https-only `CORS_ORIGINS`.
- [ ] Migration release job wired before rollout; `MIGRATE_ON_START=false`.
- [ ] Readiness probe on `/ready`, termination grace ≥ 15 s, at least two replicas.
- [ ] Web served with the headers above over HTTPS (HSTS is on).
- [ ] Open items from `docs/security-accessibility-review.md`, especially password reset.
- [ ] Privacy policy, consent texts and wellness (non-medical) disclaimer reviewed by counsel.
- [ ] Native camera device tests passed on real iOS and Android phones.
- [ ] Score formulas labelled experimental as decided in the ADR 0005 review.
