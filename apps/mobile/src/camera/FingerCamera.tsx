import {
  extractFingerYuv,
  inferPixelStride,
  type FingerFrameInput,
  type FingerSample,
} from '@edgevitals/measurement';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Platform, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type CameraDevice,
  type CameraRef,
  type Frame,
  type MeteringMode,
} from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';
import { T } from '../components/ui';
import { setCameraBreadcrumb } from '../lib/crashRecorder';
import { colors } from '../theme/tokens';
import { setExposureLock } from './captureNotes';
import { enableTorchWithRetry, type StartLog } from './fingerStart';
import { createTimestampNormalizer } from './timestamps';
import type { CameraStatus } from './types';

/**
 * Finger-scan capture (ADR 0010): BACK camera with the torch on. Each frame
 * is reduced to the mean colour of its central area on the frame thread; no
 * pixels, images or video leave that thread or the device.
 *
 * The flash is switched on after the camera reports it has started (with
 * retries, see fingerStart.ts) and off when the camera stops. Every start-up
 * step is written to `log`, which the scan screen can share.
 *
 * Status: start-up logic unit-tested; NOT yet verified on a phone.
 */
export interface FingerCameraProps {
  active: boolean;
  onFrame: (f: FingerFrameInput) => void;
  onStatus: (s: CameraStatus, detail?: string) => void;
  size: number;
  log: StartLog;
}

const TIMESTAMP_SCALE = Platform.OS === 'android' ? 1e-6 : 1e3;
// The torch changes the light level a lot, so exposure is locked a little
// later than for the face scan.
const EXPOSURE_SETTLE_MS = 2000;

interface Result {
  ts: number;
  sample: FingerSample | null;
  unsupported?: string;
  /** Frame format and size, for the start-up log. */
  info?: string;
}

export function FingerCamera({ active, onFrame, onStatus, size, log }: FingerCameraProps) {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const cb = useRef({ onFrame, onStatus });
  cb.current = { onFrame, onStatus };
  const request = useRef(permission.requestPermission);
  request.current = permission.requestPermission;
  const hasDevice = !!device;
  const hasTorch = !!device?.hasTorch;
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    logRef.current.add(
      `camera permission: ${permission.status}; back camera: ${
        device
          ? `${device.id} "${device.localizedName}" position=${device.position} hasTorch=${device.hasTorch}`
          : 'none yet'
      }`,
    );
  }, [permission.status, device]);

  useEffect(() => {
    if (!active) return;
    if (permission.status === 'not-determined') {
      cb.current.onStatus('requesting');
      request.current().catch(() => cb.current.onStatus('denied'));
    } else if (permission.status === 'denied' || permission.status === 'restricted') {
      cb.current.onStatus('denied', permission.status);
    } else if (!hasDevice) {
      const timeout = setTimeout(
        () => cb.current.onStatus('unavailable', 'Back camera not detected on this device.'),
        4000,
      );
      return () => clearTimeout(timeout);
    } else if (!hasTorch) {
      cb.current.onStatus(
        'unavailable',
        'This phone has no flash on the back camera, which the finger scan needs. Use the face scan instead.',
      );
    }
  }, [active, permission.status, hasDevice, hasTorch]);

  useEffect(() => {
    if (!active) setCameraBreadcrumb(null);
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') setCameraBreadcrumb(null);
    });
    return () => {
      sub.remove();
      setCameraBreadcrumb(null);
    };
  }, [active]);

  const ready = active && permission.hasPermission && !!device && hasTorch;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: colors.scanSurface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityLabel="Back camera view"
    >
      {ready && device ? (
        <FingerProcessingCamera device={device} active={active} size={size} cb={cb} log={log} />
      ) : (
        <T variant="small" color={colors.scanMuted}>
          Camera
        </T>
      )}
    </View>
  );
}

type Callbacks = { current: Pick<FingerCameraProps, 'onFrame' | 'onStatus'> };

async function lockExposure(camera: CameraRef | null, device: CameraDevice, size: number) {
  const modes: MeteringMode[] = [];
  if (device.supportsExposureMetering) modes.push('AE');
  if (device.supportsWhiteBalanceMetering) modes.push('AWB');
  if (!camera || modes.length === 0) {
    setExposureLock('unsupported');
    return;
  }
  try {
    await camera.focusTo(
      { x: size / 2, y: size / 2 },
      { modes, adaptiveness: 'locked', autoResetAfter: null },
    );
    setExposureLock('locked');
  } catch {
    setExposureLock('failed');
  }
}

function FingerProcessingCamera({
  device,
  active,
  size,
  cb,
  log,
}: {
  device: CameraDevice;
  active: boolean;
  size: number;
  cb: Callbacks;
  log: StartLog;
}) {
  const ref = useRef<CameraRef>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalize = useRef(createTimestampNormalizer(TIMESTAMP_SCALE));
  const reported = useRef(false);
  const firstFrame = useRef(false);
  const unmounted = useRef(false);
  useEffect(
    () => () => {
      unmounted.current = true;
      if (lockTimer.current) clearTimeout(lockTimer.current);
      // The camera stopping turns the flash off too; this is belt and braces.
      ref.current?.controller?.setTorchMode('off').catch(() => undefined);
    },
    [],
  );

  const deliver = useCallback(
    (r: Result) => {
      if (!firstFrame.current) {
        firstFrame.current = true;
        log.add(`first frame: ${r.info ?? 'no info'}`);
      }
      if (r.unsupported) {
        if (!reported.current) {
          log.add(`frame format unsupported: ${r.unsupported}`);
          reported.current = true;
          cb.current.onStatus('unavailable', r.unsupported);
        }
        return;
      }
      const t = normalize.current(r.ts);
      if (t === null) return;
      try {
        cb.current.onFrame({ t, sample: r.sample });
      } catch (e) {
        cb.current.onStatus('error', `Frame handling failed: ${String(e)}`);
      }
    },
    [cb, log],
  );
  const fail = useCallback(
    (m: string) => {
      log.add(`frame error: ${m}`);
      cb.current.onStatus('error', m);
    },
    [cb, log],
  );

  // Stable worklet (see CameraScanner): processed synchronously on the frame thread.
  const onFrame = useMemo(
    () => (frame: Frame) => {
      'worklet';
      try {
        processFingerFrame(frame, deliver);
      } catch (e) {
        scheduleOnRN(fail, `Frame processing failed: ${String(e)}`);
      } finally {
        try {
          frame.dispose();
        } catch {
          /* already released */
        }
      }
    },
    [deliver, fail],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    // The whole image is the fingertip; a small frame is plenty.
    targetResolution: { width: 320, height: 240 },
    onFrame,
  });
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  return (
    <Camera
      ref={ref}
      style={{ width: size, height: size }}
      device={device}
      isActive={active}
      outputs={outputs}
      resizeMode="cover"
      onStarted={() => {
        log.add('camera started');
        setCameraBreadcrumb('finger');
        cb.current.onStatus('running');
        setExposureLock('pending');
        enableTorchWithRetry(
          ref.current?.controller,
          log,
          undefined,
          undefined,
          () => unmounted.current,
        )
          .then((t) => {
            if (unmounted.current) return;
            if (!t.ok) {
              cb.current.onStatus(
                'error',
                `The flash could not be turned on (${t.error ?? 'unknown reason'}). The finger scan needs the flash.`,
              );
              return;
            }
            if (lockTimer.current) clearTimeout(lockTimer.current);
            lockTimer.current = setTimeout(() => {
              lockExposure(ref.current, device, size)
                .then(() => log.add('exposure lock attempted'))
                .catch(() => undefined);
            }, EXPOSURE_SETTLE_MS);
          })
          .catch((e) => cb.current.onStatus('error', `Flash start failed: ${String(e)}`));
      }}
      onStopped={() => {
        log.add('camera stopped');
        setCameraBreadcrumb(null);
      }}
      onError={(e) => {
        log.add(`camera error: ${e.message}`);
        cb.current.onStatus('error', `The camera reported an error: ${e.message}`);
      }}
      onInterruptionStarted={() => {
        log.add('camera interrupted');
        cb.current.onStatus(
          'error',
          'The camera was interrupted by another app or a call. Try again when it is free.',
        );
      }}
    />
  );
}

function processFingerFrame(frame: Frame, deliver: (r: Result) => void): void {
  'worklet';
  const fmt = frame.pixelFormat;
  const info = `${fmt} ${frame.width}x${frame.height} planar=${frame.isPlanar}`;
  const is420 = fmt === 'yuv-420-8-bit-full' || fmt === 'yuv-420-8-bit-video';
  if (!is420 || !frame.isPlanar) {
    scheduleOnRN(deliver, {
      ts: frame.timestamp,
      sample: null,
      info,
      unsupported: `This camera delivers ${fmt} frames, which the scan cannot read yet.`,
    });
    return;
  }
  const planes = frame.getPlanes();
  const yPlane = planes[0]!;
  const y = new Uint8Array(yPlane.getPixelBuffer());
  const c1 = planes[1]!;
  const c1Data = new Uint8Array(c1.getPixelBuffer());
  let u;
  let v;
  if (planes.length >= 3) {
    const c2 = planes[2]!;
    const c2Data = new Uint8Array(c2.getPixelBuffer());
    u = {
      data: c1Data,
      rowStride: c1.bytesPerRow,
      pixelStride: inferPixelStride(c1Data.length, c1.bytesPerRow, c1.height, c1.width),
    };
    v = {
      data: c2Data,
      rowStride: c2.bytesPerRow,
      pixelStride: inferPixelStride(c2Data.length, c2.bytesPerRow, c2.height, c2.width),
    };
  } else {
    u = { data: c1Data, rowStride: c1.bytesPerRow, pixelStride: 2 };
    v = { data: c1Data, rowStride: c1.bytesPerRow, pixelStride: 2, offset: 1 };
  }
  const sample = extractFingerYuv(
    {
      width: frame.width,
      height: frame.height,
      y: { data: y, rowStride: yPlane.bytesPerRow, pixelStride: 1 },
      u,
      v,
      fullRange: fmt === 'yuv-420-8-bit-full',
    },
    4,
  );
  scheduleOnRN(deliver, { ts: frame.timestamp, sample, info });
}
