# 17 — Requirements Traceability Matrix

This matrix maps the supplied PDF pages to implementation modules and test coverage. It is a working traceability artifact; IDs correspond to `01_PRODUCT_REQUIREMENTS.md`.

| PDF page | Reference screen | Requirements | Implementation area | Minimum acceptance test |
|---|---|---|---|---|
| 1 | Welcome | FR-001 | onboarding/auth | Get started and sign-in routes work |
| 2 | Consent | FR-002–006 | consent/privacy | Required consent gates continuation; optional consent independent |
| 3 | About you | FR-010–011 | profile | Values validate and persist |
| 4 | Daily rhythm | FR-012–014 | schedule/profile | Times save; Yes/No/Skip persists |
| 5 | Baseline dashboard | FR-020–025, FR-050+ | baseline/dashboard | Progress derives from stored eligible data |
| 6 | Morning check-in | FR-030–033 | assessment/check-in | Ratings and alcohol response validate |
| 7 | Scan preparation | FR-040–043 | camera UX | Permission and guidance states work |
| 8 | Active scan | FR-043–047 | measurement | Quality states are real; cancellation handled |
| 9 | Results | FR-050–055 | results/measurement | Only valid values display; disclaimer visible |
| 10 | Mature dashboard | FR-052–055, FR-060–064 | dashboard/analytics | Scores, trends and insights use approved rules |
| 11 | Evening check-in | FR-031–033 | assessment/check-in | Stress and energy persist |
| 12 | Trends | FR-060–064 | analytics/trends | Period selector and sample counts work |

## Traceability rules

- Every implemented requirement has at least one test.
- Every test maps to a requirement or a documented non-functional quality.
- Any deviation from the reference must be documented with rationale.
- Any unimplemented item remains visible as open work; do not silently mark it complete.
- Measurement claims require scientific validation evidence in addition to software tests.
