# Production readiness

Audit date: 2026-11-27. Checked against docs 11 (security and privacy), 12 (testing), 13 (roadmap), 14 (deployment) and 17 (traceability), and against `docs/security-accessibility-review.md` and `docs/deployment.md`. EdgeVitals stays wellness software. Camera readings keep their "Estimate, not validated" labels, and SpO₂ and BP stay unavailable from the RGB camera.

Status key: **Done** means it is in `main` or an open PR. **Needs you** means it needs an account, money, a legal or product decision, or a real phone.

## 1. Release blockers (doc 12 §7 release gate)

| Gate                                        | Status                  | Notes                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No unresolved critical/high security issues | Partly                  | No known critical issue. **Password reset is missing (High).** Someone who forgets their password loses access to their data. It needs an email provider (Needs you).                                       |
| No consent bypass                           | Done                    | Required consents are checked when an assessment starts and again on check-in and measurement submission (`hardening.test.ts`).                                                                             |
| No cross-account data exposure              | Done                    | Every query is scoped by `user_id`, and other users' records return 404 (API tests).                                                                                                                        |
| Demo data kept out of production            | Done                    | `DEMO_MODE_ENABLED=true` is refused when `NODE_ENV=production`, and DB checks keep simulated data out of baselines.                                                                                         |
| No fabricated or unvalidated outputs        | Labelled, not validated | Only metrics that pass the quality gates are shown, and they're labelled unvalidated. **No measurement has been scientifically validated** (doc 12 §4). Store copy and screenshots must not claim accuracy. |
| Export and deletion work                    | Done                    | Covered by API and e2e tests. Deletion needs the password.                                                                                                                                                  |
| No major accessibility blockers             | Partly                  | axe-core finds no WCAG A/AA issues on the web screens. VoiceOver/TalkBack and 200% text passes on real phones haven't been done.                                                                            |
| Third-party licences reviewed               | Partly                  | `THIRD_PARTY_NOTICES.md` exists. A licence inventory check in CI isn't set up yet.                                                                                                                          |

## 2. Fixed in this pass

| Item                                    | PR  | What changed                                                                                                                                                                   |
| --------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging deploys broke after migrations  | #41 | The API migrates on start (`MIGRATE_ON_START=true`), so you no longer open the allow list, run the workflow and redeploy. A CI test blocks non-backward-compatible migrations. |
| Blank screen on a render error          | #42 | A root error boundary shows a recovery screen with Try again and Share error details.                                                                                          |
| Release build pointing at a placeholder | #42 | Native release builds whose API URL is the `REPLACE-WITH-…` placeholder, http or a dev host show "This build can't connect".                                                   |
| Consent records lacked the app version  | #42 | `source` is now `mobile-app/<version> (<platform>)`.                                                                                                                           |
| iOS export-compliance prompt            | #42 | `usesNonExemptEncryption: false`.                                                                                                                                              |
| No dependency or secret scanning in CI  | #43 | New CI `security` job: `npm audit --omit=dev --audit-level=high` plus gitleaks. Dependabot opens weekly update PRs.                                                            |

## 3. Already in good shape (from earlier work)

- **Auth.** argon2id passwords. 15-minute access JWTs with pinned issuer, audience and algorithm. Rotating refresh tokens with reuse detection. Per-IP and per-account lockouts. Tokens stored in the Keychain/Keystore.
- **API.** zod validation, a single error envelope with a request id, helmet headers, body limit, rate limits, and logs that redact bodies and auth headers. Graceful shutdown. `/health` and `/ready` probes.
- **Privacy.** Required and optional consents are stored separately, with policy version and timestamps. Optional consents are off by default. Camera frames never leave the phone. Expired exports are purged. The hosting region is disclosed from config.
- **CI.** Format, typecheck, unit and API tests on Postgres 16. Both Docker images are built and smoke-tested. Web e2e runs under the production CSP.
- **Crash notes.** The on-device crash card covers JS and Java crashes and camera breadcrumbs, with no data leaving the phone.

## 4. Needs you

These can't be done from a PR. Each is a decision, an account or something only you can do.

1. **Production hosting and its cost.** Render free is staging only: the database expires every 30 days and has no backups, and the service sleeps after 15 minutes. Doc 14 needs backups, a tested restore and separate staging and production. That isn't possible at $0, so you need to decide on a budget and a provider (for example Render Starter plus Basic Postgres).
2. **Store accounts.** A Google Play Console account ($25 one-time), and an Apple Developer Program membership ($99/year) for iOS. Both break the $0 budget.
3. **Privacy policy and terms at a public URL.** The stores require one. The in-app policy is marked "Draft" and needs review by privacy counsel (doc 11 §8).
4. **Support contact.** An email address shown in the app and on the store listings (doc 11 §6, doc 14 §7).
5. **Regulatory position.** Confirm with counsel that the app is positioned as general wellness in each launch market. Camera SpO₂ (experimental, opt-in) and heart readings are the sensitive parts. Store review (Google Play Health apps declaration, Apple 5.1.1/1.4.1) will ask about this.
6. **Password reset.** Choose an email provider. Free tiers exist, but they need an account and a sending domain.
7. **Remote crash reporting (optional).** Today crashes are only visible if the person shares the on-device card. A hosted service such as Sentry (free tier) needs an account and a privacy-policy disclosure, and must never receive frames or readings.
8. **Score formulas.** The ADR 0005 review (Recovery/Stress/Energy) is still waiting on your three decisions.
9. **Device testing.** The native camera device test plan, VoiceOver/TalkBack passes, and the first production EAS build, all on real phones.
10. **Measurement validation.** Doc 12 §4 needs a study against reference devices before any accuracy claim. Until then, keep the "not validated" labels.

## 5. Remaining engineering work (later PRs)

- **Hide tester-only tools in production builds.** "Share signal trace" and the scan details panel show in every build today. They should be hidden in the `production` EAS profile. Do this after the scan UI PRs (#38–#40) merge, so it doesn't conflict with them.
- **Lint.** No ESLint is configured. Add `eslint` with `@typescript-eslint` and react-hooks, wired into CI.
- **Licence inventory check in CI** (doc 14 §3, step 9).
- **Performance baselines** on the test phone (doc 12 §5): startup, camera start latency, frame rate, memory and battery.
- **App Attest / Play Integrity** (review item O2). Only needed before the data is used beyond the person's own view.
- **Log retention.** Set ≤30 days on the production host and state it in the privacy policy (O5).
