# ADR 0005 — Baseline, draft scores, insights and report rules

Date: 2026-11-26 · Status: Accepted for development; **score formulas need product approval before launch**

Implemented in `packages/domain/src/analytics.ts`; versions `analytics-v0.1.0`, `scores-v0-draft`, `insights-v0.1.0`.

## Baseline (doc 09 §3, open question in doc 16)

- Per metric (HR, HRV, breathing), from **morning** scans only (resting state).
- Ready when: 14 calendar days since the first completed assessment **and** ≥7 valid samples on ≥5 distinct days in the last 28 days.
- Centre = median; usual range = median ± 1.4826·MAD (≈ ±1 SD).
- Excludes failed, cancelled, demo and simulated data. A metric that never passes its gate stays "insufficient", it is never filled in.
- Personal scores and trends unlock when HR **and** HRV baselines are ready.

## Draft scores (0–100)

| Score    | Formula                                                    | Labels                             |
| -------- | ---------------------------------------------------------- | ---------------------------------- |
| Recovery | 50 + 15·z(HRV) − 10·z(HR), this morning                    | ≥70 Good, 40–69 Fair, <40 Low      |
| Stress   | 50 − 12·z(HRV) + 8·z(HR) [+ 8·(evening stress rating − 3)] | <34 Calm, 34–66 Moderate, ≥67 High |
| Energy   | ½·Recovery + ½·25·(latest energy rating − 1)               | ≥67 Charged, 34–66 Steady, <34 Low |

z = (value − personal median) / robust SD. Each score is withheld (with a reason shown to the user) when its inputs are missing. These weights are judgement calls, not fitted or validated. They are versioned so they can change without rewriting history.

## Streak

Consecutive local days (user's IANA zone) with ≥1 completed or partial real assessment, ending today or yesterday.

## Insights

Deterministic comparisons on the user's own mornings (sleep 4–5 vs 1–3 → recovery; alcohol vs none → recovery; sleep 1–2 vs 3–5 → HRV). Shown only with ≥5 mornings per group and |Cohen's d| ≥ 0.5. Wording is associative and always says it is "an observation, not proof of cause".

## 30-day report

Unlocks after 30 calendar days **and** ≥20 days with an assessment. "Days to go" is the larger of the two remaining gaps.
