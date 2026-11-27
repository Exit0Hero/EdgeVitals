import {
  extractRoiYuv,
  inferPixelStride,
  orientationToRotation,
  uprightSize,
  type FaceBox,
  type FrameInput,
  type RoiSample,
  type Rotation,
} from '@edgevitals/measurement';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Platform, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type CameraDevice,
  type CameraOutput,
  type Frame,
} from 'react-native-vision-camera';
import {
  createFaceDetector,
  type FaceDetectorOptions,
} from 'react-native-vision-camera-face-detector';
import { scheduleOnRN } from 'react-native-worklets';
import { T } from '../components/ui';
import { setCameraBreadcrumb } from '../lib/crashRecorder';
import { colors } from '../theme/tokens';
import { createTimestampNormalizer } from './timestamps';
import type { CameraProcessingMode, CameraScannerProps } from './types';

/**
 * Native capture adapter (iOS and Android): VisionCamera frame output plus
 * on-device ML Kit face detection. Each frame is reduced to forehead/cheek
 * colour averages on the frame-processor thread; no pixels, images or video
 * leave that thread or the device.
 *
 * Status: implemented and unit-tested for buffer geometry, colour conversion
 * and timestamps, but NOT yet verified on physical devices. See
 * docs/native-camera-device-tests.md.
 */

const DETECTOR_OPTIONS: FaceDetectorOptions = {
  performanceMode: 'fast',
  cameraFacing: 'front',
  minFaceSize: 0.2,
  // Boxes stay in ML Kit's upright image coordinates; we map them to the buffer ourselves.
  autoMode: false,
};

// ML Kit on iOS is told the frame is mirrored (front camera) and reports
// coordinates in the mirrored upright image; on Android it ignores mirroring.
const MLKIT_MIRRORS = Platform.OS === 'ios';

// Frame.timestamp units to milliseconds: CameraX nanoseconds, AVFoundation seconds.
const TIMESTAMP_SCALE = Platform.OS === 'android' ? 1e-6 : 1e3;

interface NativeFrameResult {
  ts: number;
  faces: FaceBox[];
  roi: RoiSample | null;
  frameWidth: number;
  frameHeight: number;
  unsupported?: string;
}

export function CameraScanner({
  active,
  enableProcessing = true,
  processingMode = 'full',
  onFrame,
  onStatus,
  size,
}: CameraScannerProps) {
  const mode: CameraProcessingMode = enableProcessing ? processingMode : 'preview';
  const permission = useCameraPermission();
  const device = useCameraDevice('front');
  const cb = useRef({ onFrame, onStatus });
  cb.current = { onFrame, onStatus };

  // Permission and device availability drive the status shown by the scan screen.
  const request = useRef(permission.requestPermission);
  request.current = permission.requestPermission;
  const hasDevice = !!device;
  useEffect(() => {
    if (!active) return;
    if (permission.status === 'not-determined') {
      cb.current.onStatus('requesting');
      request.current().catch(() => cb.current.onStatus('denied'));
    } else if (permission.status === 'denied' || permission.status === 'restricted') {
      cb.current.onStatus('denied', permission.status);
    } else if (!hasDevice) {
      // Device enumeration is asynchronous. A temporary null device does not
      // mean camera permission was revoked or the camera was switched off.
      const timeout = setTimeout(() => {
        cb.current.onStatus(
          'unavailable',
          'Front camera not detected. Check the Android camera access toggle and try again.',
        );
      }, 4000);
      return () => clearTimeout(timeout);
    }
    // The Camera onStarted event is the authoritative running signal.
    // Avoid resetting it to 'loading_detector' during unrelated rerenders.
  }, [active, permission.status, hasDevice]);

  // Crash breadcrumb: cleared whenever the camera stops cleanly, so one that
  // survives to the next launch tells us which stage was running.
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

  const ready = active && permission.hasPermission && !!device;

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
      accessibilityLabel="Camera preview"
    >
      {ready && device ? (
        mode === 'preview' ? (
          // Preview only: no frame output, no ML Kit detector and no worklet
          // runtime are created, so nothing but CameraX preview runs.
          <CameraView
            device={device}
            active={active}
            outputs={NO_OUTPUTS}
            mode={mode}
            size={size}
            cb={cb}
          />
        ) : (
          <ProcessingCamera device={device} active={active} mode={mode} size={size} cb={cb} />
        )
      ) : (
        <T variant="small" color={colors.scanMuted}>
          Camera preview
        </T>
      )}
    </View>
  );
}

const NO_OUTPUTS: CameraOutput[] = [];

type Callbacks = { current: Pick<CameraScannerProps, 'onFrame' | 'onStatus'> };

interface InnerProps {
  device: CameraDevice;
  active: boolean;
  mode: CameraProcessingMode;
  size: number;
  cb: Callbacks;
}

function CameraView({
  device,
  active,
  outputs,
  mode,
  size,
  cb,
}: InnerProps & { outputs: CameraOutput[] }) {
  return (
    <Camera
      style={{ width: size, height: size }}
      device={device}
      isActive={active}
      outputs={outputs}
      mirrorMode="auto"
      resizeMode="cover"
      onStarted={() => {
        setCameraBreadcrumb(mode);
        cb.current.onStatus('running');
      }}
      onStopped={() => setCameraBreadcrumb(null)}
      onError={(e) => cb.current.onStatus('error', `Camera initialization failed: ${e.message}`)}
      onInterruptionStarted={() =>
        cb.current.onStatus(
          'error',
          'The camera was interrupted by another app or a call. Try again when it is free.',
        )
      }
    />
  );
}

/** Camera plus frame output. ML Kit is only created for the 'face' and 'full' stages. */
function ProcessingCamera({ device, active, mode, size, cb }: InnerProps) {
  // Created once per mount (the scan screen remounts the camera on every mode
  // change). The 'frames' stage gets no detector at all.
  const detector = useMemo(
    () => (mode === 'frames' ? null : createFaceDetector(DETECTOR_OPTIONS)),
    [mode],
  );
  const normalize = useRef(createTimestampNormalizer(TIMESTAMP_SCALE));
  const reportedUnsupported = useRef(false);

  const deliver = useCallback(
    (r: NativeFrameResult) => {
      if (r.unsupported && !reportedUnsupported.current) {
        reportedUnsupported.current = true;
        cb.current.onStatus('unavailable', r.unsupported);
        return;
      }
      const t = normalize.current(r.ts);
      if (t === null) return;
      const input: FrameInput = {
        t,
        faces: r.faces,
        roi: r.roi,
        frameWidth: r.frameWidth,
        frameHeight: r.frameHeight,
      };
      try {
        cb.current.onFrame(input);
      } catch (e) {
        cb.current.onStatus('error', `Frame handling failed: ${String(e)}`);
      }
    },
    [cb],
  );

  const fail = useCallback((message: string) => cb.current.onStatus('error', message), [cb]);

  // Stable worklet: the scan screen rerenders several times a second, and an
  // inline onFrame would re-serialise this closure and re-install the native
  // analyzer on every render while frames are in flight.
  // Frames are processed synchronously on VisionCamera's frame thread. The
  // separate async runner (a second worklet runtime that the frame is handed
  // to) was removed: every stage that used it closed the app on the iQOO
  // test phone, and CameraX already drops late frames for us
  // (dropFramesWhileBusy), so it bought nothing.
  // Stable worklet: the scan screen rerenders several times a second, and an
  // inline onFrame would re-serialise this closure on every render.
  const onFrame = useMemo(
    () => (frame: Frame) => {
      'worklet';
      try {
        processFrame(frame, mode, detector, deliver);
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
    [mode, detector, deliver, fail],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    // Small frames keep per-frame work low; the face only needs ~150 px.
    targetResolution: { width: 480, height: 640 },
    onFrame,
  });
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  return (
    <CameraView device={device} active={active} outputs={outputs} mode={mode} size={size} cb={cb} />
  );
}

type Detector = ReturnType<typeof createFaceDetector>;

/** Runs on the frame-processor runtime. Never retains the frame or its buffers. */
function processFrame(
  frame: Frame,
  mode: CameraProcessingMode,
  detector: Detector | null,
  deliver: (r: NativeFrameResult) => void,
): void {
  'worklet';
  const rawRotation = orientationToRotation(frame.orientation);
  // Isolate the frame-output path from face detection and YUV access.
  // In diagnostic modes no pixel buffers leave the frame thread.
  if (mode === 'frames' || !detector) {
    const up = uprightSize(frame.width, frame.height, rawRotation);
    scheduleOnRN(deliver, {
      ts: frame.timestamp,
      faces: [],
      roi: null,
      frameWidth: up.width,
      frameHeight: up.height,
    });
    return;
  }
  const faces = detector.detectFaces(frame);
  const boxes: FaceBox[] = [];
  let rotation: Rotation = rawRotation;
  let mirrored = MLKIT_MIRRORS && frame.isMirrored;
  for (const f of faces) {
    boxes.push({
      x: f.bounds.x,
      y: f.bounds.y,
      width: f.bounds.width,
      height: f.bounds.height,
    });
    // Defensive: if the detector reports buffer-space dimensions for a
    // rotated buffer, its boxes are already in buffer coordinates.
    if (
      rawRotation % 180 !== 0 &&
      f.frameWidth === frame.width &&
      f.frameHeight === frame.height &&
      frame.width !== frame.height
    ) {
      rotation = 0;
      mirrored = false;
    }
  }
  const up = uprightSize(frame.width, frame.height, rotation);
  if (mode === 'face') {
    scheduleOnRN(deliver, {
      ts: frame.timestamp,
      faces: boxes,
      roi: null,
      frameWidth: up.width,
      frameHeight: up.height,
    });
    return;
  }
  let roi: RoiSample | null = null;
  let unsupported: string | undefined;
  const fmt = frame.pixelFormat;
  const is420 = fmt === 'yuv-420-8-bit-full' || fmt === 'yuv-420-8-bit-video';
  if (!is420 || !frame.isPlanar) {
    unsupported = `This camera delivers ${fmt} frames, which the scan cannot read yet.`;
  } else if (boxes.length > 0) {
    const planes = frame.getPlanes();
    const yPlane = planes[0]!;
    const y = new Uint8Array(yPlane.getPixelBuffer());
    const c1 = planes[1]!;
    const c1Data = new Uint8Array(c1.getPixelBuffer());
    const c1Stride = inferPixelStride(c1Data.length, c1.bytesPerRow, c1.height, c1.width);
    let u;
    let v;
    if (planes.length >= 3) {
      const c2 = planes[2]!;
      const c2Data = new Uint8Array(c2.getPixelBuffer());
      u = { data: c1Data, rowStride: c1.bytesPerRow, pixelStride: c1Stride };
      v = {
        data: c2Data,
        rowStride: c2.bytesPerRow,
        pixelStride: inferPixelStride(c2Data.length, c2.bytesPerRow, c2.height, c2.width),
      };
    } else {
      // Bi-planar (iOS): one interleaved CbCr plane.
      u = { data: c1Data, rowStride: c1.bytesPerRow, pixelStride: 2 };
      v = { data: c1Data, rowStride: c1.bytesPerRow, pixelStride: 2, offset: 1 };
    }
    roi = extractRoiYuv(
      {
        width: frame.width,
        height: frame.height,
        y: { data: y, rowStride: yPlane.bytesPerRow, pixelStride: 1 },
        u,
        v,
        fullRange: fmt === 'yuv-420-8-bit-full',
      },
      boxes[0]!,
      rotation,
      mirrored,
    );
  }
  scheduleOnRN(deliver, {
    ts: frame.timestamp,
    faces: boxes,
    roi,
    frameWidth: up.width,
    frameHeight: up.height,
    unsupported,
  });
}
