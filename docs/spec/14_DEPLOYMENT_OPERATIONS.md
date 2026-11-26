# 14 — Deployment and Operations

## 1. Environments

- Local: developer machines, synthetic data only.
- CI: ephemeral test environment.
- Staging: production-like configuration, synthetic/test accounts.
- Production: real users, restricted access and monitored changes.

Never copy production biometric/wellness data into development.

## 2. Configuration

Use environment variables or managed secret stores for:
- database credentials;
- auth issuer/client configuration;
- signing secrets;
- notification credentials;
- storage credentials;
- monitoring DSNs.

Commit `.env.example` with placeholder names only. Never commit real values.

## 3. CI pipeline

On pull request:
1. format check;
2. lint;
3. type check;
4. unit tests;
5. API/integration tests;
6. dependency and secret scan;
7. mobile build validation;
8. migration validation;
9. license inventory check.

On release:
- signed build;
- release notes;
- migration backup/rollback plan;
- staged rollout;
- smoke tests;
- crash/health monitoring.

## 4. Database operations

- Use versioned migrations.
- Back up before destructive migrations.
- Test restore procedures.
- Avoid destructive schema changes in the same release as dependent client changes.
- Monitor query performance and connection limits.

## 5. Observability

Track:
- API availability and latency;
- assessment lifecycle failures;
- camera startup and scan completion rates;
- metric-specific valid/abstain/failure rates;
- notification delivery;
- export/deletion job status;
- app crashes.

Do not log raw video, facial images, access tokens, full check-in payloads or unnecessary personal information.

## 6. Incident response

Define:
- on-call owner;
- severity levels;
- user communication process;
- credential rotation;
- data breach assessment and notification obligations;
- rollback procedure;
- post-incident review.

## 7. App release checklist

- privacy policy and terms published;
- hosting region accurately disclosed;
- permission descriptions approved;
- screenshots and claims match actual functionality;
- demo mode disabled;
- measurement capabilities and limitations disclosed;
- export and deletion verified;
- third-party notices included;
- support contact configured.
