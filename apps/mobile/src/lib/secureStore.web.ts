/**
 * Web has no OS keychain. The refresh token is kept in sessionStorage so it
 * does not outlive the tab; the web build is a development/QA surface
 * (ADR 0001), not the primary consumer client.
 */
const store = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
export const tokenStore = {
  get: async (k: string) => store()?.getItem(k) ?? null,
  set: async (k: string, v: string) => store()?.setItem(k, v),
  remove: async (k: string) => store()?.removeItem(k),
};
