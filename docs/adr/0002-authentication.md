# ADR 0002 — Authentication

Date: 2026-11-26 · Status: Accepted (revisit before public launch)

## Context

Doc 07 prefers a managed OIDC provider; no provider, account or budget has been chosen. Development must not be blocked on vendor setup.

## Decision

The API implements email/password auth behind an `AuthProvider` interface:

- argon2id password hashing (`@node-rs/argon2`);
- short-lived (15 min) signed access tokens; opaque refresh tokens stored hashed, rotated on every use, with reuse detection revoking the token family;
- tokens kept in platform secure storage on mobile (Keychain/Keystore via `expo-secure-store`);
- rate limiting on auth endpoints.

A managed OIDC provider can replace it by implementing the same interface (token verification via JWKS).

## Consequences

We own password-security risk (reset flows, breach monitoring). Re-evaluate a managed provider before public launch.
