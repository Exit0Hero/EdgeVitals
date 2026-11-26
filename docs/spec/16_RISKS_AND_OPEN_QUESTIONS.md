# 16 — Risks and Open Questions

## 1. Product decisions

- [ ] Android only, iOS only, or both?
- [ ] Is a web app also required?
- [ ] Is the initial target a functional prototype or public production release?
- [ ] What is the final app name/branding asset?
- [ ] What authentication methods are required?
- [ ] What is the support contact and privacy-policy URL?
- [ ] What hosting region should replace `[HOSTING REGION]`?
- [ ] What languages are required at launch?

## 2. Measurement questions

- [ ] Which device models are in the initial support matrix?
- [ ] What is the minimum supported camera capability?
- [ ] Is processing on-device mandatory?
- [ ] What is the planned reference instrument for each metric?
- [ ] What is the scan duration and minimum usable signal duration?
- [ ] What is the validation population?
- [ ] Which metrics can be truthfully supported at launch?
- [ ] Should SpO₂ and blood pressure be omitted until independently validated?
- [ ] What quality/uncertainty representation is understandable to users?

## 3. Analytics questions

- [ ] What qualifies as a completed baseline?
- [ ] What minimum valid sample count is needed per metric?
- [ ] How are missed days handled?
- [ ] What are the exact Recovery, Stress and Energy formulas?
- [ ] How is the streak calculated across timezones?
- [ ] What evidence threshold enables an insight?
- [ ] What qualifies a 30-day report for unlock?

## 4. Privacy/security questions

- [ ] What personal data is strictly necessary?
- [ ] Are raw frames ever retained?
- [ ] Which third-party SDKs receive data?
- [ ] What is the retention schedule?
- [ ] What is the backup deletion timeline?
- [ ] What are the applicable launch-market privacy obligations?
- [ ] Who approves consent and policy language?

## 5. Major risks

| Risk | Impact | Mitigation |
|---|---|---|
| Camera estimates unreliable across devices | High | Per-metric validation and abstention |
| BP/SpO₂ overclaim | High | Do not enable without suitable method and evidence |
| Open-source license incompatibility | High | Audit before integration |
| Sensitive data leakage | High | Minimise collection, secure storage, threat testing |
| Baseline polluted by poor-quality readings | High | Metric-specific quality gates |
| User confusion between wellness and medical advice | High | Consistent copy and regulatory review |
| Device fragmentation | Medium/High | Device matrix and staged rollout |
| Reminder/timezone errors | Medium | IANA timezone support and tests |
| Unclear score formulas | High | Approve and version formulas before launch |

## 6. Decision log

Record each decision with:
- date;
- owner;
- context;
- options considered;
- decision;
- rationale;
- consequences;
- review trigger.
