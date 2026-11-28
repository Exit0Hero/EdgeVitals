# ADR 0011 — Face-scan engine v0.4: multi-method heart-rate fusion, PRV, breathing fusion and quality grades

Date: 2026-11-28 · Status: Proposed (synthetic verification only, untested on devices)

## Context

The v0.3 face scan (ADR 0004, ADR 0010) mostly ended in `low_signal_quality` on the test phone (iQOO Neo 9, ~20 fps front camera). The audit (`docs/measurement-engine-audit.md`) found these problems:

- Heart rate was the OR of two paths (POS whole-scan peak, PBV window consensus) with no check that they agreed.
- Frame gaps up to 0.35 s were interpolated silently.
- `sampleRateHz` reported the processing rate, not the camera rate, and the app never asked the camera for a frame rate.
- POS had no window taper and weak zero-variance guards.
- Camera beat intervals were labelled HRV.
- `qualityScore` was a heuristic that read like a confidence.

Everything below runs on the device and keeps the privacy design of ADR 0003. Only per-frame aggregates (region means, pixel counts, luma, clipping, face box) leave the frame thread. No pixels, images or video are stored or uploaded.

## Decision

### 1. Acquisition (`acquisition.ts`)

- **Real timestamps.** The camera rate is measured from frame timestamps: median and mean fps, interval CV, estimated missing frames, longest gap, and duplicate or backwards timestamps. Duplicate and backwards timestamps are removed before analysis.
- **Interpolation is never silent.** Resampling marks every grid point where a frame was expected but missing. A gap longer than 0.35 s still splits the segment. Beat detection may bridge a single missing frame, but marks longer interpolated runs (> 0.1 s) as artefacts. An analysed signal that is more than 10% invented is flagged `excessive_interpolation`, and the scan abstains.
- **Per-window artefacts** (10 s windows, 2 s hop) are detected from frame aggregates:
  - sudden intensity step (> 1% frame to frame);
  - unstable lighting (smoothed range > 4%);
  - face displacement or scale change (> 8% of face width);
  - ROI re-anchor (region pixel count changes > 20%);
  - more than 10% interpolated samples.
    A window with an artefact gets no heart-rate vote.
- **Region exposure.** A region is used only when, in at least 97% of frames, it has ≥ 40 skin pixels, luma 40-230 and ≤ 10% clipped pixels.
- **Camera.** The face scan requests 30 fps when the front camera supports it. Setting `EXPO_PUBLIC_FACE_SCAN_FPS=60` requests 60 fps, for evaluation only. The requested and camera-selected rates go into diagnostics and the signal-trace header. AE/AWB locking is unchanged (ADR 0010).

### 2. Regions (`roi.ts`, `CameraScanner.tsx`)

ML Kit landmarks (eyes, nose base, mouth corners) place the forehead and both cheeks. Geometry is in units of the inter-eye distance d:

- forehead: 0.6-1.05 d above the eyes;
- cheeks: 0.35-0.85 d below the eyes, at least 0.15 d above the mouth, and 0.35-0.85 d beside the midline.

These rectangles exclude the eyes, brows, nose and lips. The skin mask removes hair and background. The regions are computed once per held ROI box, so the same pixels are averaged while the face is still. Without landmarks, or with more than 15° of head roll, the scan falls back to the fixed v0.3 box fractions. `EXPO_PUBLIC_FACE_LANDMARKS=0` turns landmarks off if they cost frame rate on a device. Each region keeps its own RGB, pixel count, luma and clipping.

### 3. Pulse extraction (`rppg.ts`, `pos.ts`, `chrom.ts`, `pbv.ts`)

- `pos`: the v0.3 POS (Wang et al. 2017), unchanged, kept for comparison.
- `pos_v2`: POS with Hann-tapered overlap-add and zero-variance guards.
- `chrom`: CHROM (de Haan & Jeanne 2013), with moving-mean normalisation, per-window α, 50% overlap-add and guards.
- `pbv`: PBV (de Haan & van Leest 2014), unchanged.

Post-processing for the v2 methods is smoothness-priors detrending (Tarvainen 2002, 0.3 Hz) and then a zero-phase Butterworth band-pass, 0.55-3.5 Hz, order 2 (configurable 2, 4 or 6). The band-pass is wider than the 0.7-3 Hz search band so that a 42 bpm pulse is not attenuated. Each method runs on the pooled ROI and on every usable region.

**Excluded:** multi-angle rotating-channel projections and the selection methods that go with them (claimed in a third-party patent). None was implemented. Adding anything similar needs legal review first.

### 4. Heart rate (`hrFusion.ts`)

Candidates are every pair of method (pos_v2, chrom, pbv) and region (combined, forehead, left cheek, right cheek). Each candidate's Welch spectrum is normalised in band. The weight is the clamped SNR times the candidate's window-to-window stability to the 4th power. This is quality weighting, not averaging.

Two paths:

- **Windowed consensus:**
  - At least 18 clean 10 s windows.
  - Agreement within ±6 bpm in at least 0.55 + 6 / windows of them.
  - SNR at the agreed rate ≥ −2 dB.
  - At most 50% artefact windows.
- **Whole-scan spectral:**
  - SNR ≥ 3 dB.
  - The two halves agree within 6 bpm.
  - ≥ 70% of beat intervals accepted, and beat rate within 5 bpm.
  - At most 20% artefact windows.

The scan **abstains** in each of these cases:

- the two paths disagree;
- an adequate method or region conflicts with the fused rate;
- a confident autocorrelation (strength ≥ 0.5) points at a rate that is not a harmonic of it;
- the result falls outside 42-180 bpm.

Octave tracking may only re-read a window at half or double rate, and abstains if more than a quarter of windows would need it. Tracking never pulls a value toward a plausible rate.

### 5. Pulse-rate variability (`prv.ts`)

Camera intervals are pulse intervals, not ECG R-R intervals. The metric is called **pulse-rate variability (PRV)** in types, UI and docs. The metric id stays `hrv`, and the API fields are unchanged, for compatibility.

The beat pipeline:

- polarity from derivative skew;
- maximum-upslope fiducial;
- removal of false peaks with < 30% of the median prominence;
- interval classification: accepted, out of range, missed beat, extra beat, irregular, or artefact.

RMSSD uses adjacent accepted pairs only. The gates stay as they were (≥ 30 s, ≥ 13 dB SNR, accepted share, plausible range), with three additions for the capture: median ≥ 15 fps, ≤ 10% dropped frames and ≤ 5% interpolated signal. Accepted and rejected counts by reason are in diagnostics.

### 6. Breathing (`respiration.ts`)

Four respiratory signals are each estimated separately:

- baseline (RIIV), from the beat-averaged skin intensity;
- amplitude (RIAV), from beat amplitudes;
- frequency (RIFV), from accepted intervals;
- head motion (ADR 0010).

Each is resampled to 4 Hz and detrended below 0.06 Hz. A rate is reported only when two clear signals (concentration ≥ 0.5) agree within 2 /min, with ≥ 30 s and ≥ 20 beats. This is the finger-scan rule. Head motion alone can still pass on its stricter ADR 0010 gates. Breathing is computed separately from heart rate.

### 7. Quality model (`quality.ts`)

Each metric carries a `quality` object:

- grade: `good`, `fair` or `rejected`;
- status, duration, algorithm and version;
- the components it was judged on, each with its value, unit, gate and pass/fail: lighting, motion, face tracking, ROI stability, effective frame rate, dropped frames, interpolated signal, pulse SNR, spectral prominence, region and algorithm agreement, duration, beat intervals, respiratory agreement;
- an abstention reason.

A failed component means `rejected`. `good` needs every margin condition. A `grade_*` flag is added to the stored quality flags.

**There is no confidence percentage.** `uncertainty` is always `null`, with `uncertaintyNote: 'not_calibrated'`. A calibrated uncertainty needs reference recordings (section 10). `qualityScore` is kept for compatibility, documented as a heuristic and not a confidence.

### 8. SpO₂ and blood pressure

- Camera SpO₂ stays experimental and off by default (ADR 0008). It now uses the best fused candidate's pulse.
- Camera blood pressure is **not implemented**. No regression from pulse features to blood pressure is used, and none may be trained on synthetic data.
- Cuff blood-pressure logging and the licensed-SDK path (ADR 0007) are unchanged.

Camera BP could only be considered after all of the following:

- a validation protocol to a recognised standard (AAMI/ESH/ISO 81060-2);
- per-user calibration against a cuff;
- recordings across blood-pressure ranges, skin tones and devices;
- regulatory review.

### 9. Performance

To keep the JS thread light:

- Welch plans are reused, and the FFT swap was fixed.
- Windows use nfft 512 and the whole scan uses 2048.
- Interim (live) analysis runs on the pooled ROI only, with no legacy comparison and no regions.

Measured in Node on the development machine: about 130 ms per final 45 s analysis, and about 26 ms per interim look. Phone timings have not been measured.

### 10. Validation harness (`packages/measurement/validation`, not shipped in the app)

`npm run validate -w @edgevitals/measurement -- --synthetic | --dir <recordings> | --trace <file> --ref-hr <bpm>` runs:

- the pipeline;
- the v0.3 estimators;
- every method and region on its own;
- PRV intervals against reference beats;
- breathing against a reference.

It reports MAE, RMSE, bias, SD, Bland-Altman limits, coverage, rejection rate and false acceptances on pulseless recordings, by participant, device and condition. Splits are always by participant, and leakage throws. Real recordings use `ValidationRecording` JSON or a shared signal trace (v4 adds face position and per-region exposure). A report that contains any synthetic recording carries a banner saying it is not validation.

## Calibration (all synthetic)

The thresholds were set on simulated recordings: phone-like pulseless noise, white noise, and weak or strong pulses with drops, movement, lighting steps and distorted beats. Held-out seeds gave the results below. **These are software regression guards, not accuracy.**

| Check                                                  | v0.4       | v0.3                      |
| ------------------------------------------------------ | ---------- | ------------------------- |
| False HR on pulseless phone-like noise (interim looks) | 0 / 2,080  | 3 / 3,280 at the v0.3 bar |
| False HR on white noise                                | 0 / 300    | —                         |
| False HR on pulseless faces with regions               | 0 / 200    | —                         |
| Weak pulse (0.08% of DC): HR reported, 45 s            | 74 / 100   | ~79 / 100                 |
| Weak pulse (0.08% of DC): HR reported, 75 s            | 85 / 100   | ~80 / 100                 |
| False breathing rate, no breathing modulation          | 0 / 450    | ~30%                      |
| Breathing reported, with modulation                    | ~73-83%    | —                         |
| PRV RMSSD error, high-SNR synthetic                    | 1.7-4.1 ms | up to 8.9 ms              |

Synthetic validation set: 84 recordings, 6 simulated participants × 7 conditions × 20/30 fps. Heart-rate coverage was 41.7% (v0.3: 47.2%) with MAE 0.08 bpm (v0.3: 0.20) and 0 / 12 false acceptances for both. v0.4 abstains on every recording with two head movements in 60 s, because fewer than 18 clean windows remain. v0.3 reported a value on half of them. This trade (fewer readings, no unsupported ones) is deliberate. The synthetic pulse has PBV's exact colour signature and a sinusoidal breathing movement, so it favours PBV and makes breathing look far easier than it is.

## Consequences

- Fewer face-scan readings than v0.3 under movement. More readings come from longer still scans (75 s) and better frames (30 fps, landmarks).
- Stored rows carry `algorithm_name` (`rppg-fusion-welch`, `prv-slope-fiducial`, `resp-fusion-riiv-riav-rifv`), version `0.2.0` and config `v0.4-fusion-prv`. v0.3 and v0.4 rows can be told apart.
- The face scan's "Scan details" card shows the v0.4 checks: measured, requested and selected fps, window votes, per-method and per-region rates, PRV interval counts and breathing signals. The v0.3 checks follow, for comparison.

## Required before calling any of this validated

1. Reference recordings: ECG (HR and intervals) and capnography or a chest belt (breathing), with participants across skin tones, ages, lighting, devices and motion. Use the harness with participant splits.
2. Device measurement on the iQOO Neo 9 and at least one iPhone:
   - selected and delivered fps at 30 and 60 fps;
   - landmark cost on the frame thread;
   - interim analysis time on the JS thread.
3. An uncertainty model calibrated on those recordings, before any confidence value is shown.
4. Re-tuning the thresholds on the reference data's training folds only.
