# 13 — Delivery Roadmap

## Phase 0 — Decisions and repository setup

Deliverables:
- confirm target platforms and app scope;
- choose stack and hosting region;
- create repository, branching and CI conventions;
- decide auth provider and privacy policy owner;
- complete open-decision register.

Exit: architecture and product decisions approved.

## Phase 1 — Visual foundation

Deliverables:
- design tokens and reusable components;
- welcome, consent, profile and schedule screens;
- navigation and responsive layout;
- accessibility baseline;
- screenshot comparison against PDF.

Exit: all onboarding screens reproduce the reference and work with local state.

## Phase 2 — Accounts and persistence

Deliverables:
- authentication;
- profile persistence;
- consent ledger;
- schedule storage;
- export/delete request skeleton;
- database migrations and API tests.

Exit: user data persists securely and authorization tests pass.

## Phase 3 — Check-ins and dashboard

Deliverables:
- morning/evening check-ins;
- assessment state machine;
- baseline progress;
- dashboard empty/loading/error states;
- reminders.

Exit: user can complete a full assessment flow with clearly labelled demo data.

## Phase 4 — Camera experience

Deliverables:
- native camera preview;
- permissions and device checks;
- face/ROI and lighting quality feedback;
- scan lifecycle, cancellation and recovery;
- privacy review.

Exit: camera workflow is stable; no claims of valid biometrics yet.

## Phase 5 — Measurement research integration

Deliverables:
- repository audit;
- candidate algorithm adapters;
- offline evaluation harness;
- reference dataset/protocol;
- quality gates and abstention;
- per-metric validation report.

Exit: only metrics meeting pre-approved validation gates can be enabled. Unsupported metrics remain unavailable.

## Phase 6 — Baseline and analytics

Deliverables:
- per-metric baseline;
- Recovery/Stress/Energy formulas;
- trend aggregation;
- evidence-based insights;
- report generation.

Exit: formulas documented, versioned and tested; insufficient-data states work.

## Phase 7 — Hardening and release

Deliverables:
- security and privacy review;
- accessibility audit;
- supported-device matrix;
- performance testing;
- production infrastructure;
- monitoring and incident response;
- app-store preparation.

Exit: release checklist signed off.

## Work management

Each issue should include:
- requirement ID;
- user story;
- acceptance criteria;
- design reference/page;
- API/data impact;
- privacy/safety impact;
- test plan;
- dependency and rollout notes.

Do not merge large unreviewed changes just to maintain speed.
