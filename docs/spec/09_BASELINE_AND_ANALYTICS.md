# 09 — Baseline, Scores and Analytics

## 1. Source requirements

The POC says:
- a personal baseline is established after 14 days;
- daily Recovery, Stress and Energy scores unlock on day 14;
- trends are compared with the user's own usual values;
- trends include 7-day, 30-day and 90-day views;
- insights may relate check-in context (such as sleep/alcohol) to observed readings.

The PDF does not define exact formulas, minimum sample counts, statistical methods or score calibration. These must be approved before production.

## 2. Baseline design

Maintain a separate baseline per metric because each metric may have different validity and availability.

Candidate robust statistics:
- median as central tendency;
- median absolute deviation or robust quantiles for dispersion;
- time-of-day-aware comparisons where justified;
- exclusion of invalid, simulated and out-of-domain measurements.

Do not assume 14 calendar days automatically yields enough valid data.

## 3. Eligibility proposal

Configurable policy, to be confirmed:
- 14 calendar days since first eligible assessment;
- minimum valid sample count per metric;
- minimum distribution across days and morning/evening sessions;
- quality-gated samples only;
- no simulated/demo values.

Display both day progress and metric-specific sample sufficiency.

## 4. Recovery, Stress and Energy scores

Do not hard-code the sample values shown in the PDF (e.g. Recovery 78, Stress 24, Energy 72). They are wireframe examples.

Before implementation, define:
- inputs and units;
- feature normalisation;
- personal versus population reference;
- weighting;
- missing-data handling;
- minimum input coverage;
- score direction and interpretation;
- score stability and uncertainty;
- versioning and rollback;
- user explanation.

A score must be withheld when required input coverage is insufficient.

## 5. Trend aggregation

Each trend response should include:
- time window;
- sample count;
- average/median;
- optional robust range;
- valid/missing count;
- time-of-day grouping;
- baseline version;
- algorithm version.

Never interpolate missing values in a way that suggests a measurement occurred.

## 6. Insight generation

Start with transparent deterministic rules, not an opaque generative model.

Example format:
> “In your recorded check-ins, mornings after sleep ratings of 4–5 had a higher average recovery score than other mornings. This is an observation from your data, not proof that sleep rating caused the difference.”

Rules:
- minimum sample count;
- effect-size threshold;
- uncertainty reporting;
- no causal wording;
- avoid sensitive inference;
- suppress insights with weak or contradictory evidence;
- allow user to dismiss insights.

## 7. Report unlock

The PDF shows a 30-day report progress card. Define whether unlock is based on 30 calendar days, minimum valid sessions, or both. Until defined, show progress transparently and do not promise a report on a fixed date regardless of data availability.
