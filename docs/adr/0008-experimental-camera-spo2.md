# ADR 0008 — Experimental camera SpO₂ (opt-in, unvalidated)

Date: 2026-11-27 · Status: Accepted (product owner: "implement all the features however you can")

## Context

The product owner wants SpO₂ and blood pressure from the camera at $0. ADR 0007 added a
licensed-SDK boundary, but no vendor is licensed yet. This ADR covers what we can honestly
build ourselves from published research.

## Decision

### SpO₂: experimental estimator behind a Settings switch

- **Method.** Ratio of ratios on the face's red and blue channels, with the published linear
  calibration of U. Bal, "Non-contact estimation of heart rate and oxygen saturation using
  ambient light", _Biomedical Optics Express_ 6(1):86–97, 2015, doi:10.1364/BOE.6.000086:
  `R = (AC_red/DC_red)/(AC_blue/DC_blue)`, `SpO₂ = 101.6 − 5.834·R` (Sec. 3, Fig. 7; fitted on 6
  healthy volunteers against a Masimo Rad-87).
- **Our processing.** 10 s windows every 1 s over the longest usable segment. DC = window mean.
  AC = standard deviation of the 0.7–3 Hz band-passed channel. This differs from Bal, who used the
  raw channel's standard deviation; we band-pass so lighting drift and motion are not counted as
  pulse. The coefficients were **not** refitted for this change.
- **Gates.** Runs only after heart rate passes all of its gates (ADR 0004). Each window needs
  both colour channels to correlate (|r| ≥ 0.5) with the rPPG pulse. ≥ 60 % of windows must pass.
  The interquartile range of per-window estimates must be ≤ 3 points. Results outside
  90–100 % are reported as "No reliable reading", because the published fit did not include
  desaturation. Synthetic tests: 0 of 20 noise-only captures produce a value.
- **Known accuracy.** An independent benchmark of this method on 107 people (VIPL-HR; Cheng et
  al., _Bioengineering_ 2024, 11:251) reports MAE 1.84 points overall and 4.48 points when SpO₂ <
  95 %. That is worse than the 4-point limit for an approved pulse oximeter. Camera SpO₂ is also
  known to be affected by skin tone and lighting. EdgeVitals has not validated it at all.
- **Storage.** `method = 'camera_experimental'`, `algorithm_name = 'bal2015-ror-red-blue'`,
  `validation = 'unvalidated'`, quality flag `experimental`. The schema and database (migration 003) accept `camera_experimental` for SpO₂ only. It never decides a scan's outcome and never
  feeds baselines, scores or insights. A licensed SDK reading, when present, replaces it.
- **UI.** Off by default. Settings → "Experimental estimates" explains the method and its limits.
  Values carry an orange "Experimental" pill, and the results screen says not to use them for
  health decisions and to use a pulse oximeter if unwell.

### Blood pressure: not built

No published method turns a single facial rPPG signal into blood pressure with a formula we
can apply. Published camera BP uses deep models trained on cuff-labelled datasets, and even those
are imprecise: Curran et al. 2025 (arXiv:2503.00890, 143 visits) report systolic MAE ≈ 11.4 mmHg,
r ≈ 0.54. Steinman et al. 2021 (_Front. Digit. Health_ 3:770096) note that pulse-timing methods
need per-person cuff calibration and periodic recalibration. A hand-written formula would be a
fabricated number, so blood pressure stays "Not available" unless a licensed SDK (ADR 0007)
provides it. The product owner has been offered manual cuff logging as an alternative.
