# 10 — Open-Source Repository Reverse-Engineering and Integration Plan

## 1. Objective

Reuse proven, compatible open-source components where they materially accelerate EdgeVitals, while preserving license compliance, attribution, security and scientific validity.

“Reverse-engineering” here means inspecting public source code, documentation, build systems, algorithms and behaviour. It does not mean bypassing access controls, copying proprietary code, or removing license notices.

## 2. Component research areas

- rPPG and camera pulse estimation;
- face detection and facial landmark/ROI tracking;
- image quality and motion detection;
- signal processing and HRV analysis;
- respiratory-rate estimation;
- mobile camera integration;
- charts and health dashboard UI;
- authentication, consent and export/delete workflows;
- notification scheduling.

## 3. Discovery process

For each candidate repository:
1. Search GitHub by technical concept and paper title.
2. Read README, docs, source tree and examples.
3. Identify language, runtime, platform and dependencies.
4. Inspect commit history, releases, open issues and maintainer activity.
5. Read the full license file and third-party notices.
6. Identify data collection, telemetry and network behaviour.
7. Run tests and demo in an isolated environment.
8. Reproduce the claimed output using documented inputs.
9. Compare implementation with the underlying paper/specification.
10. Record decision: adopt, adapt, research-only, reject.

## 4. Repository evaluation scorecard

Score each category 0–5 and add written evidence:
- license compatibility;
- maintenance and release health;
- code quality and test coverage;
- documentation quality;
- dependency/security health;
- device/platform compatibility;
- privacy and data handling;
- reproducibility;
- scientific evidence;
- integration effort.

A high aggregate score does not override a disqualifying license or safety issue.

## 5. License review

- Identify SPDX license.
- Check whether commercial use is allowed.
- Check copyleft obligations and distribution requirements.
- Preserve copyright, attribution and NOTICE files.
- Record modified files and changes.
- Review bundled model weights and datasets separately; their licenses may differ from code.
- Obtain legal review for ambiguous or incompatible licenses.

Never assume a public GitHub repository is public domain.

## 6. Security review

Inspect:
- install scripts and postinstall hooks;
- network calls and telemetry;
- secrets and sample credentials;
- unsafe deserialisation;
- native binaries;
- dependency vulnerabilities;
- file permissions;
- camera/media persistence;
- data upload endpoints.

Run untrusted repositories in a sandbox without production credentials or personal data.

## 7. Integration rules

- Prefer small, isolated adapters over copying large codebases.
- Pin versions/commits.
- Maintain a `THIRD_PARTY_NOTICES.md`.
- Keep upstream origin and local modifications documented.
- Add contract tests around adopted components.
- Avoid forking unless required.
- Do not merge demo-only measurement outputs into production paths.

## 8. Required audit artifact

For every candidate, create a record with:
- repository URL and commit SHA;
- date reviewed;
- license;
- component purpose;
- architecture summary;
- setup/test result;
- data flow;
- scientific evidence and limitations;
- security findings;
- integration plan;
- decision and reviewer.

## 9. Initial research queries

- `rPPG remote photoplethysmography`
- `camera based heart rate estimation`
- `facial landmark detection mobile`
- `HRV signal processing`
- `respiratory rate estimation rPPG`
- `mobile camera frame processing`
- `wellness dashboard mobile app`

These are search terms, not endorsements of any repository.

## 10. Exit criteria

No repository is integrated until its license, provenance, security posture, technical fit and testability are understood. No biometric estimator is enabled for real users solely because a demo works.
