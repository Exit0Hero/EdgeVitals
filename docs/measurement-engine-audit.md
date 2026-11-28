# Measurement engine audit (2026-11-28)

Scope: `packages/measurement`, `packages/domain`, `apps/mobile` capture code,
ADRs 0003, 0004, 0008 and 0010, `docs/native-camera-device-tests.md`. Each item was
checked against the code that runs, not against the documentation. "Works" means
the code runs and is covered by tests. Only synthetic data and a few shared signal
traces exist. No result here has been compared with a reference device.

## Actual execution path (face scan, native)

1. `apps/mobile/src/camera/CameraScanner.tsx`: VisionCamera 5 front camera and a
   YUV frame output (target 480x640, `dropFramesWhileBusy`).
   - No frame-rate constraint is set. The iQOO Neo 9 delivered 20 fps (exactly 50 ms).
   - AE/AWB are metered and locked with `focusTo(..., adaptiveness: 'locked')` 1.5 s
     after `onStarted` where the device supports it. The outcome is recorded only in
     the trace header.
2. The frame-processor worklet runs `processFrame` → ML Kit `detectFaces` (fast mode,
   no landmarks). Then:
   - `smoothFaceBox` → `holdRoiBox` → a fixed skin mask per held box.
   - `extractRoiYuv` averages the skin pixels of three box-fraction rectangles
     (forehead and both cheeks) and returns combined and per-region means. No pixels
     leave the worklet.
3. `scheduleOnRN` → `createTimestampNormalizer` (frame timestamps, ns on Android and
   s on iOS, converted to ms). → `ScanSession.pushFrame` → `assessFrame`, which checks
   face presence, oval, size, luma, clipping, skin pixels and face speed.
4. `ScanSession.liveState` re-runs the whole `analyzeSession` every 2 s after 15 s of
   usable signal. `shouldFinish` stops at 45 s once HR has passed, otherwise at 75 s
   usable or 90 s total.
5. `analyzeSession` (`pipeline.ts`):
   1. The longest usable segment is split at gaps over 0.35 s or colour steps over 3%.
   2. The combined RGB is linearly resampled to 30 Hz.
   3. HR comes from POS → Welch, with halves and beat checks, OR from PBV
      window consensus.
   4. HRV is RMSSD from peak-detected intervals.
   5. Breathing needs RIFV and green-intensity RIIV to agree, with head-motion
      breathing as the fallback.
   6. SpO₂ is the experimental opt-in.
6. `apps/mobile/src/lib/measurements.ts` `toSubmission` → API (`measurementSchema`) →
   results screen.

The finger scan follows a parallel path: `FingerCamera.tsx` → `extractFingerYuv` →
`FingerScanSession` → `analyzeFingerSession`.

## 1. Implemented and working (on synthetic tests; device behaviour noted)

- Frame gates, segment selection, exposure-ramp and lighting-step splitting.
- POS (Wang 2017) and PBV (de Haan & van Leest 2014) projections.
- Welch PSD with the de Haan SNR definition.
- PBV window-consensus HR, with false acceptance calibrated on simulated noise.
- The skin mask and held ROI box in the worklet (fixes detector jitter noise).
- Per-region colour means from the native path, used only for a diagnostic SNR.
- The finger PPG pipeline:
  - The best channel is chosen.
  - Slope fiducials are refined by template alignment.
  - Bootstrap timing noise feeds the HRV gate.
  - RIIV, RIAV and RIFV breathing are fused.
  - Real-phone HR has been seen (about 85 bpm), with HRV correctly withheld.
- Signal trace export (v3), crash breadcrumbs, cuff BP logging, the licensed-SDK
  boundary (no SDK is installed).

## 2. Partially implemented

- **Frame timing.** Timestamps are kept, but `diagnostics.sampleRateHz` reports the
  30 Hz resampling rate, not the camera's rate. Dropped frames are counted only as
  intervals > 2.5× the median. Nothing reports jitter, non-monotonic timestamps or
  how much of the analysed signal was interpolated.
- **Regions.** Three regions are extracted natively, but HR uses only the pooled
  average. The web adapter (`extractRoi`) returns no per-region data. Regions are
  fixed fractions of the face box: no landmarks are used, so yaw or roll moves the
  cheek boxes onto the nose or background.
- **Exposure lock.** Implemented, but not confirmed on a device. Frames before the
  lock are only handled by colour-step splitting.
- **Motion.** Only the face-centre speed is checked. Box-size changes and the
  stability of the ROI tracking are not assessed.

## 3. Experimental

- Camera SpO₂ (ADR 0008): off by default, opt-in, and labelled experimental.
- Breathing from head movement (ADR 0010).
- All HR, HRV and breathing thresholds are engineering defaults tuned on synthetic
  signals.

## 4. Not implemented

- CHROM.
- Detrending. Only a 2nd-order Butterworth band-pass is used.
- Autocorrelation checks.
- Per-window motion or lighting artefact rejection.
- Agreement checks across regions or across algorithms.
- A frame-rate request to the camera, and recording of the frame rate the camera
  actually achieved.
- Landmark-based ROIs.
- A shared quality model or grade.
- PRV naming: camera intervals are called "HRV".
- An offline validation harness with reference data, and Bland–Altman statistics.
- Camera blood pressure. This is correct: it must not exist without paired cuff data.

## 5. Correctness problems and limitations found

1. **HR is an OR of two paths with no agreement check.** If POS-spectral passes at one
   rate and PBV-consensus at another, the first is reported silently.
2. **Missing data is bridged silently.** Gaps up to 0.35 s are interpolated linearly
   (7 frames at 20 fps), and how much was interpolated is not recorded.
3. **`sampleRateHz` misreports the frame rate.** It reports the processing rate (30)
   even when the camera ran at 20 fps.
4. **The face camera requests no frame rate.** Front cameras often default to 20 fps
   or less in low light.
5. **POS has no protection against degenerate input.** Overlap-add has no taper.
   Zero-variance protection covers only `alpha`, and a window with a zero or
   negative channel mean is skipped without being reported.
6. **Breathing (RIIV) uses raw green intensity.** That signal carries lighting drift,
   and the RIFV/RIIV agreement has no clarity requirement. A ±3 /min agreement
   between two noisy peaks is a weak test.
7. **Camera-derived intervals are labelled HRV.** They are pulse-rate variability.
8. **The quality score is a heuristic.** `qualityScore` is a linear map of SNR, not a
   calibrated confidence. It is not shown as a percentage, but nothing documents this.
9. **Interim updates are expensive.** Every 2 s the full analysis re-runs on the JS
   thread, including HRV and breathing, which `shouldFinish` does not need.

## 6. Improve rather than replace

- Keep: `dsp.ts`, `pos.ts` (legacy POS kept for comparison), `pbv.ts`, `yuv.ts`,
  `frameQuality.ts`, `session.ts`, `finger.ts`, `motionBreathing.ts`,
  `experimentalSpo2.ts`, `sdkProvider.ts`.
- Extend: `yuv.ts` and `roi.ts` (landmark regions, per-region luma and clipping),
  `pipeline.ts` (HR fusion, PRV and respiration modules, quality model), `config.ts`
  (version bump), `CameraScanner.tsx` (fps constraint, selected fps, landmarks), and
  the trace format (v4).

## 7. What was done (v0.4, see ADR 0011)

Each numbered problem above, and where it was addressed:

1. HR fusion requires the windowed and whole-scan paths, and every adequate method and region, to agree, or it abstains (`hrFusion.ts`).
2. Interpolated samples are marked, counted and reported. Above 10% the scan abstains; PRV allows 5% (`acquisition.ts`).
3. `diagnostics.acquisition` reports the measured camera rate next to the processing rate.
4. The face scan requests 30 fps (60 optional) and records what the camera selected.
5. POS v2 adds a Hann taper and guards; skipped windows are counted (`pos.ts`, `chrom.ts`).
6. Breathing fuses RIIV, RIAV, RIFV and head motion, each detrended with a clarity requirement (`respiration.ts`).
7. Camera intervals are pulse-rate variability (PRV) in types, UI and docs.
8. `quality` gives a grade from documented gates. `uncertainty` stays null until it is calibrated (`quality.ts`).
9. Interim looks use the pooled ROI only and skip the legacy comparison.
