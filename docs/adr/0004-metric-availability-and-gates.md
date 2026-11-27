# ADR 0004 — Metric availability, quality gates and labelling

Date: 2026-11-26 · Status: Accepted (product owner chose "Show as labelled estimates")

## Decision

| Metric         | Status                                                              | Method                                                                            |
| -------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Heart rate     | Shown as **Estimate, not validated** when gates pass                | POS (Wang et al. 2017) → Butterworth 0.7–3 Hz → Welch spectral peak               |
| HRV (RMSSD)    | Shown as estimate when gates pass                                   | Peak detection with parabolic refinement, local-median IBI rejection              |
| Breathing rate | Shown as estimate when gates pass                                   | Agreement of two estimators: RSA from IBI series and low-frequency skin intensity |
| SpO₂           | **"Not available"** from our pipeline (licensed SDK only, ADR 0007) | Ordinary RGB face video is not a validated SpO₂ method                            |
| Blood pressure | **"Not available"** from our pipeline (licensed SDK only, ADR 0007) | Camera-only BP is not a substitute for a validated cuff                           |

### Gates (config `v0.1-engineering-defaults`, `packages/measurement/src/config.ts`)

- Frame gates: one face inside the guide oval, face width 18–85% of frame, ROI luma 45–225, ≤10% clipped pixels, ≥150 skin pixels, face speed ≤0.35 face-widths/s, measured against the face position ≥0.3 s earlier (frame-to-frame differences at 30 fps mostly measure detector box jitter).
- Signal: longest usable segment in which consecutive usable frames are ≤0.35 s apart; isolated unusable frames inside that limit are skipped and bridged by resampling (v0.1; v0 restarted the segment on any single bad frame). HR needs ≥15 s, HRV and breathing ≥30 s. Target 45 s usable, hard stop 90 s.
- HR: SNR ≥ −2 dB **and** first/second-half HR agree within 6 bpm **and** ≥70% plausible beat intervals **and** beat-derived HR within 5 bpm of spectral HR. 0 of 150 synthetic noise-only captures pass (regression test).
- HRV: SNR ≥ 13 dB, ≥20 intervals, ≥80% accepted, RMSSD 5–200 ms. Synthetic tests showed beat-timing noise inflates RMSSD by 50–100 ms at moderate SNR, hence the strict gate.
- Breathing: both estimators agree within 3 breaths/min.

### What these numbers are not

They are engineering defaults tuned on **synthetic** signals with known ground truth. They are not validated against reference instruments on real people. Every stored measurement records `algorithm`, `version`, `config` and `validation: "unvalidated"`.

## Required before removing the "not validated" label

Per doc 08 §6 / doc 12 §4: a pre-registered protocol per metric against ECG (HR, HRV) and capnography or chest-belt (breathing), representative devices, skin tones, lighting, and Bland–Altman analysis, approved by a qualified team.
