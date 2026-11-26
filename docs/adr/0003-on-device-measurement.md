# ADR 0003 — On-device measurement, no raw video

Date: 2026-11-26 · Status: Accepted

## Decision

Camera frames are processed on the device. For each frame only aggregate statistics leave the capture adapter: mean skin colour of three facial ROIs (forehead, both cheeks), luma, clipped-pixel fraction and the face box. No frame, image or video is written to disk, kept beyond the current frame, or uploaded. `ScanSession` clears its statistic buffers on finish and cancel. The API receives only derived metric results and quality metadata.

## Consequences

No server-side reprocessing of historical scans is possible. Research use of raw video would need a separate consent and data-flow review (doc 11).
