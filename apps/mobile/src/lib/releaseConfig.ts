/**
 * Build-time configuration checks for release builds.
 *
 * A phone build talks to whatever `EXPO_PUBLIC_API_URL` was baked in at build
 * time. If that was left at the eas.json placeholder, or falls back to the
 * localhost development default, every request fails and the person sees
 * only "offline" errors. Release builds instead stop on a clear screen that
 * says the build is misconfigured.
 */

export interface ReleaseConfigInput {
  apiUrl: string;
  /** React Native's __DEV__: true in the Metro dev server, false in release builds. */
  isDev: boolean;
  platform: string;
}

/** Returns why the build can't be used, or null when it is fine. */
export function releaseConfigProblem({
  apiUrl,
  isDev,
  platform,
}: ReleaseConfigInput): string | null {
  // Development and the web build (served with its own CSP-pinned API origin,
  // and tested against a local API in CI) are not checked.
  if (isDev || platform === 'web') return null;
  if (/REPLACE/i.test(apiUrl)) return 'The API address in this build is still a placeholder.';
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return 'The API address in this build is not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'The API address in this build does not use HTTPS.';
  if (['localhost', '127.0.0.1', '10.0.2.2', '0.0.0.0'].includes(url.hostname))
    return 'The API address in this build points at a development machine.';
  return null;
}

/**
 * Consent `source` value: records which app version and platform captured
 * each consent choice (docs 11 §2). Kept within the API's 60-character limit.
 */
export function consentSource(appVersion: string | null | undefined, platform: string): string {
  return `mobile-app/${appVersion || 'unknown'} (${platform})`.slice(0, 60);
}
