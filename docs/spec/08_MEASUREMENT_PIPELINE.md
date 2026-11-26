# 08 — Measurement Pipeline and Scientific Feasibility

## 1. Purpose

The reference proposes two short face scans per day and five headline metric categories:
- heart rate;
- heart-rate variability (HRV);
- breathing rate;
- oxygen saturation (SpO₂);
- blood pressure.

This document separates a visual scan experience from the scientific validity of each output.

## 2. Proposed pipeline

1. Device capability check.
2. Camera permission and capture.
3. Face detection and stable facial region-of-interest (ROI) tracking.
4. Lighting, exposure, motion and occlusion checks.
5. Frame timestamp validation and dropped-frame analysis.
6. Signal extraction from selected facial regions.
7. Detrending, filtering and artifact rejection.
8. Metric-specific estimator.
9. Signal quality / uncertainty assessment.
10. Per-metric pass, fail or abstain decision.
11. Persist derived output and provenance.
12. Discard raw frames/buffers unless separately approved for research.

## 3. Metric feasibility matrix

| Metric | Potential camera method | Key limitation / required validation |
|---|---|---|
| Heart rate | rPPG pulse waveform from facial colour variation | Sensitive to motion, illumination, skin reflectance, camera pipeline and device |
| HRV | Beat-to-beat interval estimation from high-quality pulse waveform | Small timing errors can materially distort variability; validate against ECG/reference |
| Breathing rate | Respiratory modulation of pulse signal or subtle motion | Requires robust signal and clear definition of estimator |
| SpO₂ | Optical multi-wavelength methods are generally relevant; ordinary RGB face video is not automatically sufficient | Do not claim reliable saturation without suitable sensing method and rigorous validation |
| Blood pressure | Research models may infer estimates from signals and context | Camera-only estimation is not a substitute for validated cuff measurement; strong validation and regulatory review required |

A software prototype can display “not available” for unsupported metrics. That is preferable to manufacturing plausible numbers.

## 4. rPPG research evaluation

For every candidate implementation:
- identify the original paper and exact algorithm;
- identify input requirements (RGB, frame rate, resolution, face ROI);
- inspect preprocessing and filters;
- inspect training/evaluation datasets;
- check subject overlap and data leakage;
- check evaluation protocol and reference sensor;
- examine subgroup/device/lighting performance;
- reproduce published metrics where possible;
- run independent tests on supported devices;
- record failure and abstention rates.

Do not use benchmark performance as a guarantee of real-world consumer performance.

## 5. Quality gates

A metric is valid only if:
- capture duration meets a predeclared requirement;
- sufficient usable frames are available;
- ROI tracking remains stable;
- motion and lighting are within validated ranges;
- signal quality passes metric-specific thresholds;
- estimator output is within supported operating domain;
- no known pipeline error occurred.

Thresholds must be empirically established, versioned and tested. Do not invent thresholds to make a demo succeed.

## 6. Calibration and validation

For each metric, specify:
- intended population and exclusions;
- reference instrument;
- simultaneous measurement protocol;
- sample size rationale;
- repeatability and reproducibility;
- bias and limits of agreement;
- subgroup analysis;
- device model and OS coverage;
- environmental conditions;
- missingness and abstention;
- algorithm version and locked evaluation set.

A qualified research/clinical/statistical team should approve the protocol before any accuracy claim.

## 7. Demo mode

Demo data must:
- be generated from deterministic fixtures;
- be visibly labelled “Demo data”;
- never be uploaded as measured data;
- never enter user baselines, reports or insights;
- be disabled in production or protected behind a developer flag.

## 8. User-facing fallback

If a metric is unsupported or fails quality:
- say “We couldn't get a reliable reading this time”;
- explain an actionable retry tip;
- preserve other valid metrics;
- do not show a guessed value;
- do not imply a medical problem.

## 9. Regulatory boundary

The POC states that the product is a wellness app, not a medical device. Actual regulatory status depends on intended use, marketing claims, features, output and jurisdiction. Seek qualified regulatory review before launch.

References:
- FDA General Wellness guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices
- FDA device software/mobile medical app policy: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications
- FDA examples of regulated device software functions: https://www.fda.gov/medical-devices/device-software-functions-including-mobile-medical-applications/examples-device-software-functions-fda-regulates
