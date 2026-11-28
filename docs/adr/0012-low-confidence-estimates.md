# ADR 0012: Low-confidence estimates and per-scan advice

Status: accepted (engineering defaults, not validated against a reference device)
Date: 2026-11-28
Config: `v0.5-low-confidence` (face, pipeline 0.3.0), `finger-v0.2-low-confidence-breathing` (finger, 0.2.0)

## Context

After v0.4.1 (ADR 0011) the owner's real scans gave:

- **Face, trace 3** (iQOO Neo 9, locked exposure, 45 s, 20 fps): a real, steady ~60 bpm pulse at about 0-2 dB SNR. v0.3 read it (61 bpm). v0.4.1 rejects it: 15 of 18 fused windows agree and the fused bar needs 0.91, and the best single method agrees in 67% of windows against the 70% needed.
- **Face, trace 4** (90 s, head moving every 10-20 s): longest steady stretch 23 s, and no consistent pulse inside it. Every rule abstains.
- **Finger** (60 s): heart rate 86 bpm passes. PRV is withheld because the beat timing error is about 23-27 ms (PRV needs at most 8 ms). Breathing is withheld because the two agreeing breathing signals reach a clarity of only 0.37.

Abstaining with only "Signal too weak" left the owner with no reading and no way to know what to change.

## Decision

### 1. Low-confidence face heart rate

When the strict fusion abstains for lack of evidence (`weak_signal`, `windows_disagree`, `no_carrying_method`, `too_short`), but never for a conflict (methods, regions, autocorrelation or paths pointing at different rates), the result falls back to the v0.3 single-method rule:

- PBV on the pooled skin ROI, 10 s windows every 2 s;
- agreement at least 0.55 + 5/windows of at least 16 windows, with SNR at least -2 dB at that rate;
- the whole-scan POS spectrum peaks within 6 bpm of the same rate;
- the fused windows' own rate, when there is one, is within 6 bpm;
- no acquisition failure (frame rate, dropped frames, interpolation) and at most half the windows are artefacts.

The value is stored as `valid` with quality flag `low_confidence`, grade `low` and algorithm `pbv-window-consensus-v0.3`. PRV and colour breathing stay withheld (flag `heart_rate_low_confidence`), because they need a much stronger pulse. Head-motion breathing keeps its own independent gates.

The single fixed candidate matters. v0.4 raised the bar because fusing 12 candidates and picking the most stable one is a selection, and selection lets noise through. One fixed candidate has no selection.

Calibration (all synthetic, `phoneNoise` fixtures):

- 8,000 pulseless captures of 45, 60 and 75 s, pooled and per-region noise, with noise scales 0.7-1.3: 0 low-confidence readings.
- Before the whole-scan spectral check was added, 1 of 1,000 passed. Its windows said 65 bpm and its spectrum said 102.
- Weak simulated pulses (0.04-0.08% of skin brightness): the low tier adds 2-8% coverage on top of the strict path, and is within 1 bpm of the truth.
- Owner trace 3: 61 bpm, labelled low confidence. Trace 4: still nothing.

The same runs found the strict v0.4.1 path accepting 4 of about 8,000 pulseless captures with varied noise scale (about 0.05%). That is a separate issue and is not changed here.

### 2. Low-confidence finger breathing

If the strict rule fails (two modulations each at least 0.5 clear, within 2/min), a breathing rate may still be shown as low confidence. This needs two modulations within 1/min of each other, both at least 0.45 clear.

- On 1,500 simulated no-breathing traces, the best such pair reached 0.41.
- On 300 traces with breathing, pairs at 0.40 or above were within 0.8/min of the truth.

The owner's finger trace (0.37) stays withheld, because pure noise reaches that clarity.

### 3. Finger PRV unchanged

Shorter template windows and a lower band edge were tried on the owner's trace and on synthetic traces. The bootstrap timing estimate dropped from 27 ms to about 9 ms. But measured against the synthetic truth, RMSSD errors were +50% to +250%. So the lower estimate was the estimator under-reading, not a real improvement. The 8 ms gate stays.

### 4. Kept out of baselines

Low-confidence values are shown on their own scan and on Today's last-assessment tiles, labelled "Low confidence". The API marks them `lowConfidence`, and `validSamples` (baselines, trends) and the score inputs skip them.

### 5. Per-scan advice

`apps/mobile/src/lib/scanAdvice.ts` turns the scan's own diagnostics into "what was measured, and what to change". Examples:

- pulse strength in % darkening;
- beat-timing error against the PRV limit;
- breathing clarity against the 45% and 50% bars;
- camera frame rate (dim light);
- share of frames with the face outside the oval;
- the longest steady stretch;
- face pulse SNR.

These are aggregates already in memory. Nothing new is stored or uploaded.

## Consequences

- More scans show a heart rate. Some of them carry a visible "Low confidence" label, with an explanation card.
- No accuracy claim is made. All calibration is synthetic until reference data exists (ADR 0004).
- Device checks still to do are listed in `docs/native-camera-device-tests.md`.
