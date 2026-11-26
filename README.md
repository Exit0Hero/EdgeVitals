# EdgeVitals

A daily wellness companion: two short face-camera check-ins a day, a personal 14-day baseline, and honest trends.

> Wellness software, not a medical device. Camera estimates are not clinically validated.

See `docs/spec/` for the product specification and `docs/adr/` for architecture decisions.

## Layout

- `packages/measurement`: on-device rPPG pipeline (POS, quality gates). Pure TypeScript.
- `packages/domain`: shared schemas and analytics (baseline, draft scores, insights).
- `apps/api`: Fastify + PostgreSQL API (auth, consents, assessments, dashboard, export, deletion).
- `apps/mobile`: Expo app (iOS, Android, web). The web build has a working camera scan; the native camera adapter is in progress.

## Development

```sh
npm ci
npm run typecheck && npm test   # API tests need Postgres (see apps/api/.env.example)
cd apps/mobile && npm run web   # Expo dev server
```

End-to-end tests: `apps/mobile/e2e/README.md`. Design differences from the wireframes: `docs/design-deviations.md`.

## Deployment

Docker images, environment variables, migrations, hosting headers and the launch checklist: `docs/deployment.md`.
