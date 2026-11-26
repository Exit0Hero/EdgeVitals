# 05 — Technology Decisions and Recommended Stack

## 1. Recommendation

For Android and iOS from one codebase, evaluate **React Native with TypeScript** as the default product stack, with native modules for camera and performance-sensitive image processing where needed.

Alternative: Flutter. Choose one after a short technical spike; do not maintain two mobile clients without a clear business reason.

## 2. Proposed stack

| Layer | Candidate | Rationale |
|---|---|---|
| Mobile | React Native + TypeScript | Shared iOS/Android UI and domain code |
| Navigation | React Navigation | Mature mobile navigation patterns |
| Server state | TanStack Query | Cache, retries and request lifecycle |
| Forms | React Hook Form + schema validation | Consistent form validation |
| API | Node.js + TypeScript (Fastify or NestJS) | Shared language and typed contracts |
| Database | PostgreSQL | Relational integrity and migrations |
| ORM | Prisma or Drizzle | Typed data access; choose one |
| Auth | Managed OIDC provider or well-reviewed auth service | Avoid custom password security |
| Jobs | Managed queue/worker | Reminders, export, analytics |
| Charts | Accessible native chart library | Trends visualisation |
| CI | GitHub Actions | Automated quality gates |
| Monitoring | Privacy-configured crash/error monitoring | Reliability without sensitive payloads |

These are recommendations, not requirements from the PDF. Confirm cost, hosting region, vendor terms and supported platform capabilities before committing.

## 3. Measurement technology

Do not choose a computer-vision or signal-processing library based only on stars or demo quality. Evaluate:
- license and commercial-use permissions;
- supported devices and camera frame access;
- maintenance activity;
- reproducible evaluation datasets;
- algorithm description and limitations;
- independent validation;
- computational load and thermal behaviour;
- privacy/data flow;
- ability to return quality/abstention status.

## 4. Technology selection spike

Before locking the stack, create a 3–5 day spike that:
1. builds a minimal iOS/Android camera preview;
2. measures frame rate and memory on representative devices;
3. runs a face/ROI detector;
4. records only synthetic/test signals unless explicit research consent exists;
5. tests offline persistence and API auth;
6. confirms CI builds both platforms.

## 5. Avoid

- A web-only camera page presented as equivalent to a native app without testing.
- Unmaintained biometric repositories.
- Committing API keys or signing credentials.
- Storing camera recordings by default.
- Hardcoding sample results into production UI.
- Treating a package's output as medically accurate because its README claims so.
