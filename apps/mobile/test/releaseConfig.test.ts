import { describe, expect, it } from 'vitest';
import { consentSource, releaseConfigProblem } from '../src/lib/releaseConfig';

const release = (apiUrl: string, platform = 'android') =>
  releaseConfigProblem({ apiUrl, isDev: false, platform });

describe('releaseConfigProblem', () => {
  it('accepts an https API in a release build', () => {
    expect(release('https://edgevitals-staging-api.onrender.com')).toBeNull();
    expect(release('https://api.example.com/base', 'ios')).toBeNull();
  });

  it('rejects the eas.json placeholder', () => {
    expect(release('https://REPLACE-WITH-PRODUCTION-API')).toMatch(/placeholder/);
  });

  it('rejects plain http and development hosts', () => {
    expect(release('http://api.example.com')).toMatch(/HTTPS/);
    expect(release('https://localhost:4000')).toMatch(/development/);
    expect(release('https://10.0.2.2')).toMatch(/development/);
    expect(release('not a url')).toMatch(/valid URL/);
  });

  it('skips the check in development and on the web build', () => {
    expect(
      releaseConfigProblem({ apiUrl: 'http://localhost:4000', isDev: true, platform: 'android' }),
    ).toBeNull();
    expect(release('http://localhost:4000', 'web')).toBeNull();
  });
});

describe('consentSource', () => {
  it('records app version and platform within 60 characters', () => {
    expect(consentSource('1.0.0', 'android')).toBe('mobile-app/1.0.0 (android)');
    expect(consentSource(undefined, 'ios')).toBe('mobile-app/unknown (ios)');
    expect(consentSource('9'.repeat(100), 'ios').length).toBe(60);
  });
});
