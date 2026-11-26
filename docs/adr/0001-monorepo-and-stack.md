# ADR 0001 — Monorepo and stack

Date: 2026-11-26 · Status: Accepted

## Context

The repository was empty. Docs 04/05 recommend React Native + TypeScript, Node + TypeScript API, PostgreSQL, typed contracts and CI.

## Decision

- npm-workspaces monorepo:
  - `apps/mobile` — Expo (React Native + TypeScript). Expo is used because it gives iOS, Android and a web target from one codebase; the web target lets CI run Playwright screen-parity tests against the PDF. Native camera frame access uses a development build (not Expo Go).
  - `apps/api` — Fastify + TypeScript, PostgreSQL via `pg`, SQL migrations.
  - `packages/measurement` — dependency-free TypeScript rPPG pipeline shared by native and web capture adapters.
  - `packages/domain` — shared types, validation schemas, baseline/analytics rules.
- GitHub Actions for format, typecheck, unit/integration tests.

## Consequences

One language across the stack and shared contract types. The measurement core must stay dependency-free and fast enough for on-device use.
