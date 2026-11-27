# ADR 0010 — Finger-on-camera scan, and breathing from head movement

Date: 2026-11-27 · Status: Accepted (product owner approved the plan in the project thread)

## Context

On the test phone (iQOO Neo 9, ~20 fps front camera) the face pulse sits near 0 dB SNR. Heart rate can pass the window-consensus gate (config v0.3), but HRV needs the timing of every beat and breathing needs a clean respiratory modulation, so both abstain on the face scan.

## Decision

### 1. Finger scan (method `finger_ppg`)

A second scan type, chosen on "Get ready to scan". The user rests a fingertip over the **back camera** while the **torch** is on (contact, transmissive PPG: the principle of a clip-on finger oximeter). The pulse is typically 10-100× stronger than on the face.

- Capture: back camera, `torchMode="on"` only while the scan runs, 30 fps requested, 320×240 YUV, AE/AWB locked 2 s after start. Each frame is reduced on the frame thread to the mean colour of the central half of the image plus "lens covered" (share of red-dominant pixels) and red-clipping shares. No pixels leave the frame thread.
- Frame checks: lens not covered (< 85% red-dominant), too dark (torch off or finger pressed white), too bright (all channels saturated), finger moving (> 10% colour step). Live guidance shows the reason; a faint-pulse hint suggests pressing more lightly or warming the hand.
- Length: 60 s of clean signal; **hard stop at 75 s** so the torch does not heat the phone. The first 2 s of each clean stretch are discarded (finger and exposure settling).
- Heart rate: channel with the best pulse SNR among non-clipped channels (red is often clipped at 255 by the torch). Passes when SNR ≥ 6 dB, halves agree within 5 bpm, ≥ 80% of beat intervals accepted and beat HR within 4 bpm of the spectral peak.
- Beats: maximum upstroke slope, then re-timed by cross-correlating each beat with the average beat (parabolic sub-sample refinement). This halved RMSSD error on synthetic traces compared with the slope point alone.
- HRV: RMSSD (value) and SDNN (`value_secondary`). Needs ≥ 30 s, SNR ≥ 8 dB, ≥ 30 accepted intervals, ≥ 85% accepted, RMSSD 5-200 ms, **and an estimated beat-timing error ≤ 4 ms** (Cramér-Rao style estimate from the per-beat residual and template slope). Timing noise inflates RMSSD; on synthetic traces, estimates ≤ 3.3 ms came with 0 to +7 ms RMSSD error, ≥ 6 ms with about +20 ms.
- Breathing: three respiratory modulations of the pulse (Karlen et al., IEEE TBME 2013): baseline intensity, beat amplitude and beat interval. A rate is reported only when two clear modulations (≥ 50% of 0.05-0.7 Hz power within ±0.04 Hz of the peak) agree within 2 /min.
- SpO₂: **not reported**. The Bal (2015) calibration in ADR 0008 was fitted for ambient light reflected from the face, not torch light through a finger; using it here would be a different, unvalidated method. The red/blue ratio of ratios is recorded in scan details only. Blood pressure: not available.
- Results show the last 10 s of the measured pulse with the detected beats, RMSSD, SDNN, beats used and a signal-strength figure (labelled as scan quality, not a health measure). The waveform stays on the device and is never uploaded.
- Storage: migration 006 adds `finger_ppg` to the method check and forbids SpO₂/BP values from it. Finger HRV and heart rate feed the same baseline and the draft Recovery/Stress scores (ADR 0005) as face values; the method is stored on every row so they can be separated later.

### 2. Breathing from head movement (face scan)

Breathing moves the head slightly up and down. The vertical velocity of the smoothed face-box centre (normalised by face height) is analysed at 10 Hz. It passes when ≥ 30 s are available, the whole-scan peak holds ≥ 55% of 0.05-0.7 Hz power, ≥ 75% of 20 s windows (2 s hop) agree within 2 /min, and the movement is 0.05-3% of face height. It is used only when the colour-based breathing estimators abstain, does not depend on heart rate passing, and is flagged `head_motion`. Velocity (not position) is analysed because posture drift is a random walk that produced false 6-8 /min peaks on position.

## Synthetic checks (regression guards, not validation)

- Finger: 0 of 240 pulseless traces produced any value; 0 of 150 pulses without respiratory modulation produced a breathing rate; HR within 1.5 bpm, RMSSD within 8 ms and SDNN within 6 ms on clean traces at 20-30 fps; breathing within 1 /min.
- Head movement: 0 of 300 jitter-and-drift-only traces passed; 1.5-2 px breathing movement on a 300 px face passes at 12-24 /min; slow (8 /min) breathing needs about 3 px.

## Not done / limits

- **Untested on a phone.** Torch behaviour, AE lock with the torch, red clipping and real finger pressure effects are unknown until an EAS build is tried.
- The thresholds are engineering defaults from synthetic signals. Before removing "not validated": ECG-referenced HRV and capnography/chest-belt breathing studies on representative phones (doc 08 §6, doc 12 §4).
- The torch can make the camera area warm; the 75 s cap is a precaution, not a measured thermal limit.
