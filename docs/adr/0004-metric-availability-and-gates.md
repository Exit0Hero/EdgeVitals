# ADR 0004 — Metric availability, quality gates and labelling

Date: 2026-11-26 · Status: Accepted (product owner chose "Show as labelled estimates")

## Decision

> **Superseded in part by [ADR 0011](0011-face-scan-fusion-prv-quality.md) (config `v0.4-fusion-prv`).** Face-scan heart rate is now a quality-weighted fusion of POS v2, CHROM and PBV over the pooled ROI and each region, and it abstains when they disagree. Camera intervals are reported as pulse-rate variability (PRV, metric id `hrv`). Breathing needs two clear respiratory signals that agree within 2 /min. The labelling rules and "not validated" requirements below still apply. The v0.3 gates are kept in `legacyAnalysis` for comparison only.

| Metric         | Status                                                              | Method                                                                                           |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Heart rate     | Shown as **Estimate, not validated** when gates pass                | PBV (de Haan & van Leest 2014) window consensus, or POS (Wang et al. 2017) → Welch spectral peak |
| HRV (RMSSD)    | Shown as estimate when gates pass                                   | Peak detection with parabolic refinement, local-median IBI rejection                             |
| Breathing rate | Shown as estimate when gates pass                                   | Agreement of two estimators: RSA from IBI series and low-frequency skin intensity                |
| SpO₂           | **"Not available"** from our pipeline (licensed SDK only, ADR 0007) | Ordinary RGB face video is not a validated SpO₂ method                                           |
| Blood pressure | **"Not available"** from our pipeline (licensed SDK only, ADR 0007) | Camera-only BP is not a substitute for a validated cuff                                          |

### Gates (config `v0.3-window-consensus`, `packages/measurement/src/config.ts`)

- Frame gates: one face inside the guide oval, face width 18–85% of frame, ROI luma 45–225, ≤10% clipped pixels, ≥150 skin pixels, face speed ≤0.35 face-widths/s, measured against the face position ≥0.3 s earlier (frame-to-frame differences at 30 fps mostly measure detector box jitter).
- Signal: longest usable segment in which consecutive usable frames are ≤0.35 s apart; isolated unusable frames inside that limit are skipped and bridged by resampling (v0.1; v0 restarted the segment on any single bad frame). A frame-to-frame change of mean skin colour above 3% in any channel also splits the segment (v0.2): phones ramp exposure and white balance by 5–17% per frame for about the first second, and a pulse is well under 1%. HR needs ≥15 s, HRV and breathing ≥30 s. Target 45 s usable; if heart rate has not passed by then the scan continues to 75 s usable (v0.3); hard stop 90 s.
- HR passes by either of two checks (v0.3):
  - **Window consensus** (needs ≥16 windows, about 40 s): PBV pulse with the standard signature [0.33, 0.77, 0.53]; 10 s Hann windows every 2 s each vote with their strongest 42–180 bpm peak; the share of votes within ±6 bpm of the consensus must reach 0.55 + 5/windows (0.83 at 45 s, 0.74 at 60 s, 0.70 at 75 s), and SNR at that rate ≥ −2 dB. The reported value is the median of the agreeing votes.
  - **Whole-scan spectrum**: POS SNR ≥ 3 dB **and** first/second-half HR agree within 6 bpm **and** ≥70% plausible beat intervals **and** beat-derived HR within 5 bpm of spectral HR. With the v0.2 floor of −2 dB this path accepted about 0.4% of simulated phone-like noise captures, hence 3 dB.
- HR false acceptance (regression tests, simulated): 0 of 150 white-noise captures (15–45 s), 0 of 120 phone-like coloured-noise captures (20–90 s). Calibration runs outside the test suite: 0 of 4,000 pulseless captures across 15–90 s, and 0 of 1,500 pulseless 76 s captures checked at every interim step from 45 to 75 s (which is what the extended scan does). Weak simulated pulses (amplitude 0.08% of skin brightness, SNR about +1 dB): 95% read at 45 s, all within 2 bpm.
- HRV: SNR ≥ 13 dB, ≥20 intervals, ≥80% accepted, RMSSD 5–200 ms. Synthetic tests showed beat-timing noise inflates RMSSD by 50–100 ms at moderate SNR, hence the strict gate.
- Breathing: both estimators agree within 3 breaths/min. If they abstain, breathing from head movement may pass on its own gates (ADR 0010).

#### Why v0.3 (real phone data, iQOO Neo 9, Android)

Three shared traces (mean skin colour per frame, no images). Trace 1 (v0.1) was dominated by the auto-exposure ramp (fixed in v0.2 by splitting at colour steps). Trace 2 (90 s, exposure unlocked) had 96% of in-band variance common to all three colour channels from auto-exposure/white-balance steps; no estimator finds a pulse and v0.3 still rejects it. Trace 3 (45 s, exposure and white balance locked) shows a steady pulse near 61 bpm in most 10 s windows of the PBV and green signals, but at about 0 dB whole-scan SNR one noise burst moved the half-scan peaks 12 bpm apart and beat detection accepted 64–69% of intervals, so v0.2 rejected it. POS is weak on this camera because its blue channel is noisiest (subsampled chroma); PBV down-weights the noisiest channel. v0.3 reads trace 3 as 61 bpm (16 of 18 windows agree; needed 15). HRV and breathing still abstain on trace 3: their gates are unchanged and need a much stronger signal.

### What these numbers are not

They are engineering defaults tuned on **synthetic** signals with known ground truth, plus three real traces from one phone with no reference device. They are not validated against reference instruments on real people. Every stored measurement records `algorithm`, `version`, `config` and `validation: "unvalidated"`.

## Required before removing the "not validated" label

Per doc 08 §6 / doc 12 §4: a pre-registered protocol per metric against ECG (HR, HRV) and capnography or chest-belt (breathing), representative devices, skin tones, lighting, and Bland–Altman analysis, approved by a qualified team.
