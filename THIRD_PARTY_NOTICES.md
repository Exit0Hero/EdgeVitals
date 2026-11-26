# Third-party notices

## MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)

Used by the web camera adapter for on-device face detection. The WASM runtime and ES module are copied from `node_modules` into `apps/mobile/public/mediapipe/` at build time (`scripts/copy-mediapipe.mjs`) and served from the app's own origin.

- Copyright The MediaPipe Authors.
- Licensed under the Apache License, Version 2.0. https://www.apache.org/licenses/LICENSE-2.0

## BlazeFace short-range face detection model

`apps/mobile/public/mediapipe/blaze_face_short_range.tflite`

- From the MediaPipe Face Detector model release (`blaze_face_short_range`, float16).
- SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`.
- Licensed under the Apache License, Version 2.0, per the MediaPipe model card.

No camera frames or face images are sent anywhere; only per-frame colour statistics of skin regions are kept in memory during a scan (ADR 0003).
