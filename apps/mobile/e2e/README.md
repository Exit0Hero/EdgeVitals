# End-to-end tests (web build)

Playwright drives the exported web build against a local API and Postgres.

```sh
# 1. API with demo mode on (local only)
cd apps/api
DATABASE_URL=postgres://edgevitals:edgevitals@localhost:5432/edgevitals_dev \
JWT_SECRET=$(openssl rand -base64 48) CORS_ORIGINS=http://localhost:8081 \
DEMO_MODE_ENABLED=true AUTH_RATE_LIMIT_PER_MIN=1000 npx tsx src/server.ts

# 2. Web build and static server
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:4000 npm run build:web
node e2e/serve.mjs dist 8081

# 3. Tests
npm run e2e
# History screens (seeds labelled fixtures into a LOCAL database):
E2E_DATABASE_URL=postgres://edgevitals:edgevitals@localhost:5432/edgevitals_dev npm run e2e
# Save screenshots:
E2E_SCREENSHOTS=/some/dir npm run e2e
```

Chromium's fake camera streams a test pattern with no face, so the scan tests check that no reading is ever produced from it. The happy path uses demo mode, whose results are labelled simulated and excluded from analytics. `history.spec.ts` submits hand-written values tagged `algorithm_name: 'e2e-fixture'`; they are test fixtures, not measurements, and the spec refuses to run against a non-local database.
