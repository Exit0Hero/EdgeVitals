import { File, Paths } from 'expo-file-system';

/**
 * On-device crash notes for test builds.
 *
 * Release builds close the app on a fatal JavaScript error, including errors
 * raised inside camera worklets (react-native-worklets forwards those to
 * React Native as fatal). Testers rarely have adb, so we write the error to a
 * small local file before the app closes and show it on the next launch.
 *
 * Uncaught Java/Kotlin exceptions are written to the same file by a small
 * handler installed in MainApplication (plugins/withJavaCrashRecorder.js).
 * A C++ crash kills the process before anything can run, so for that case
 * (and any other silent exit) the camera writes a
 * breadcrumb while it runs and removes it when it stops cleanly: a breadcrumb
 * that is still present at the next launch means the app closed while that
 * camera stage was running.
 *
 * Only error text and the camera stage are stored. No images, frames or
 * health data are ever written, and nothing leaves the device unless the user
 * chooses to share the report.
 */

export interface CrashReport {
  /** native_error is written by the Java handler in plugins/withJavaCrashRecorder.js. */
  kind: 'js_error' | 'native_error' | 'closed_during_camera';
  at: string;
  message: string;
  stack?: string;
  /** Camera stage running at the time, if any: preview, frames, face or full. */
  cameraStage?: string;
}

const CRASH_FILE = 'last-crash.json';
const BREADCRUMB_FILE = 'camera-running.json';

let installed = false;
let currentStage: string | null = null;

function file(name: string): File {
  return new File(Paths.document, name);
}

function writeJson(name: string, value: unknown): void {
  try {
    file(name).writeSync(JSON.stringify(value));
  } catch {
    // Recording must never cause a second failure.
  }
}

function readJson<V>(name: string): V | null {
  try {
    const f = file(name);
    if (!f.exists) return null;
    const text = f.textSync();
    f.delete();
    return JSON.parse(text) as V;
  } catch {
    return null;
  }
}

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Wrap React Native's global error handler. Call once, before the app renders. */
export function installCrashRecorder(): void {
  if (installed) return;
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu) return;
  installed = true;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      const e = error instanceof Error ? error : new Error(String(error));
      const report: CrashReport = {
        kind: 'js_error',
        at: new Date().toISOString(),
        message: `${e.name}: ${e.message}`.slice(0, 2000),
        stack: e.stack?.slice(0, 6000),
        cameraStage: currentStage ?? undefined,
      };
      writeJson(CRASH_FILE, report);
    }
    previous(error, isFatal);
  });
}

/** Record which camera stage is running; pass null when the camera stops cleanly. */
export function setCameraBreadcrumb(stage: string | null): void {
  currentStage = stage;
  if (stage) {
    writeJson(BREADCRUMB_FILE, { stage, at: new Date().toISOString() });
  } else {
    try {
      const f = file(BREADCRUMB_FILE);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  }
}

/** Return (and clear) what happened before the previous app exit, if anything. */
export function takeCrashReport(): CrashReport | null {
  const crash = readJson<CrashReport>(CRASH_FILE);
  const crumb = readJson<{ stage: string; at: string }>(BREADCRUMB_FILE);
  if (crash) return crash;
  if (crumb) {
    return {
      kind: 'closed_during_camera',
      at: crumb.at,
      cameraStage: crumb.stage,
      message:
        'The app closed while the camera was running and no JavaScript error was recorded. ' +
        'This usually means a native crash, or that the app was closed from recent apps.',
    };
  }
  return null;
}
