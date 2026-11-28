# Architecture Decision Records

| #                                                | Decision                                                                              | Status                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------- |
| [0001](0001-monorepo-and-stack.md)               | Monorepo with Expo React Native app, Fastify API, shared TS packages                  | Accepted                                |
| [0002](0002-authentication.md)                   | Self-hosted email/password auth behind an adapter                                     | Accepted (revisit before public launch) |
| [0003](0003-on-device-measurement.md)            | On-device rPPG, no raw video stored or uploaded                                       | Accepted                                |
| [0004](0004-metric-availability-and-gates.md)    | Metric availability, quality gates and "Estimate, not validated" labelling            | Accepted                                |
| [0007](0007-licensed-sdk-spo2-blood-pressure.md) | SpO₂ and blood pressure only from a licensed SDK, behind a provider interface         | Accepted (vendor pending)               |
| [0008](0008-experimental-camera-spo2.md)         | Opt-in experimental camera SpO₂ (Bal 2015 ratio of ratios); no camera BP              | Accepted                                |
| [0009](0009-health-app-sync.md)                  | Read-only SpO₂ and blood pressure from Health Connect / Apple Health                  | Accepted                                |
| [0010](0010-finger-scan-and-motion-breathing.md) | Finger-on-camera scan (HR, HRV, breathing) and face-scan breathing from head movement | Accepted (untested on devices)          |
| [0011](0011-face-scan-fusion-prv-quality.md)     | Face-scan v0.4: multi-method HR fusion, PRV, breathing fusion, quality grades         | Proposed (synthetic verification only)  |
| [0012](0012-low-confidence-estimates.md)         | Low-confidence face HR and finger breathing; per-scan advice on results               | Accepted (synthetic calibration only)   |
