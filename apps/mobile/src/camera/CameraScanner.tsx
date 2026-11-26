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
import { Platform, View } from 'react-native';
import {
  Camera,
  useAsyncRunner,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  type FaceDetectorOptions,
} from 'react-native-vision-camera-face-detector';
import { scheduleOnRN } from 'react-native-worklets';
import { T } from '../components/ui';
import { colors } from '../theme/tokens';
import { createTimestampNormalizer } from './timestamps';
import type { CameraScannerProps } from './types';

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
  onFrame,
  onStatus,
  size,
}: CameraScannerProps) {
  const permission = useCameraPermission();
  const device = useCameraDevice('front');
  const detector = useFaceDetector(DETECTOR_OPTIONS);
  const runner = useAsyncRunner();
  const cb = useRef({ onFrame, onStatus });
  cb.current = { onFrame, onStatus };
  const normalize = useRef(createTimestampNormalizer());
  const reportedUnsupported = useRef(false);

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
      cb.current.onStatus('unavailable', 'No front camera was found on this device.');
    } else {
      // The camera reports 'running' from onStarted once frames flow.
      cb.current.onStatus('loading_detector');
    }
  }, [active, permission.status, hasDevice]);

  // A new capture starts a new timeline.
  useEffect(() => {
    if (active) {
      normalize.current = createTimestampNormalizer();
      reportedUnsupported.current = false;
    }
  }, [active]);

  const deliver = useCallback((r: NativeFrameResult) => {
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
    cb.current.onFrame(input);
  }, []);

  const fail = useCallback((message: string) => cb.current.onStatus('error', message), []);

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    // Small frames keep per-frame work low; the face only needs ~150 px.
    targetResolution: { width: 480, height: 640 },
    onFrame(frame: Frame) {
      'worklet';
      const handled = runner.runAsync(() => {
        'worklet';
        try {
          const rawRotation = orientationToRotation(frame.orientation);
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
        } catch (e) {
          scheduleOnRN(fail, `Frame processing failed: ${String(e)}`);
        } finally {
          frame.dispose();
        }
      });
      if (!handled) frame.dispose(); // still busy with the previous frame
    },
  });

  const outputs = useMemo(
    () => (enableProcessing ? [frameOutput] : []),
    [enableProcessing, frameOutput],
  );
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
      {ready ? (
        <Camera
          style={{ width: size, height: size }}
          device={device}
          isActive={active}
          outputs={outputs}
          mirrorMode="auto"
          resizeMode="cover"
          onStarted={() => cb.current.onStatus('running')}
          onError={(e) => cb.current.onStatus('error', e.message)}
          onInterruptionStarted={() =>
            cb.current.onStatus(
              'error',
              'The camera was interrupted by another app or a call. Try again when it is free.',
            )
          }
        />
      ) : (
        <T variant="small" color={colors.scanMuted}>
          Camera preview
        </T>
      )}
    </View>
  );
}
