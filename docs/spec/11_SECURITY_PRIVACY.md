# 11 — Security, Privacy and Consent

## 1. Privacy principles

- Data minimisation.
- Purpose limitation.
- Explicit, understandable consent.
- Separate optional research/analytics consent.
- User access, export and deletion.
- No raw face-video retention by default.
- Transparency about hosting region and subprocessors.
- No use of user data for model training or research without a separately reviewed purpose and valid consent.

## 2. Consent model

The POC includes:
1. required consent to process readings for wellness insights;
2. required acknowledgement that the app is wellness software, not a medical device;
3. optional anonymised-data contribution.

Store each choice independently with:
- purpose;
- wording/policy version;
- grant/withdraw timestamp;
- user identity;
- source/app version.

Do not bundle optional consent with required consent. Optional consent must be off by default and must not affect core app access.

## 3. Camera privacy

- Request permission only when needed.
- Explain purpose before permission prompt.
- Prefer on-device processing.
- Avoid writing camera frames to disk.
- Clear in-memory buffers after processing/cancellation.
- Do not include frames in crash reports.
- If server upload is proposed, create a dedicated data-flow and consent review.
- Provide a visible camera-active state.

## 4. Security controls

- TLS for all network traffic.
- Managed encryption at rest.
- Secure token storage using platform facilities.
- Short-lived access tokens and refresh-token rotation.
- Server-side authorization on every user-owned resource.
- Rate limiting and abuse protection.
- Input validation and output encoding.
- Dependency scanning and secret scanning.
- Database backups with access restrictions.
- Audit logs for sensitive operations.
- Separate development, staging and production environments.

## 5. Threat model

Assets:
- identity and contact data;
- profile data;
- wellness readings and check-ins;
- consent records;
- authentication tokens;
- export files;
- camera-derived signals.

Threats:
- account takeover;
- insecure direct object reference;
- token leakage;
- excessive employee access;
- third-party SDK collection;
- insecure backups;
- accidental raw-frame retention;
- log leakage;
- malicious dependency;
- export-link exposure.

Mitigations must be verified by tests and review, not just documented.

## 6. Data subject controls

- View and edit profile.
- View consent choices.
- Withdraw optional consent.
- Export data in a documented format.
- Request account deletion.
- Explain processing and retention.
- Provide support contact and request status.

## 7. Hosting region

The POC contains a placeholder `[HOSTING REGION]`. Do not ship this placeholder. Select and verify the actual region, data residency implications, subprocessors and backup locations before launch.

## 8. Compliance

Applicable requirements depend on launch markets, data types, intended use, vendors and business model. Obtain qualified privacy and regulatory counsel. Do not claim compliance with a law or standard solely because a checklist exists.
