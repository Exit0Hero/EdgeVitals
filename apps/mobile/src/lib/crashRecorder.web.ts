import type { CrashReport } from './crashRecorder';

export type { CrashReport } from './crashRecorder';

// The browser shows errors in its console; nothing is recorded on the web.
export function installCrashRecorder(): void {}
export function setCameraBreadcrumb(_stage: string | null): void {}
export function takeCrashReport(): CrashReport | null {
  return null;
}
