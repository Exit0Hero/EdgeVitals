import { extractRoi, type FaceBox } from '@edgevitals/measurement';
import type * as Vision from '@mediapipe/tasks-vision';
import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { CameraScannerProps } from './types';

// Metro cannot bundle the MediaPipe ES module (it contains a computed dynamic
// import), so it is served from public/mediapipe and loaded at runtime. The
// Function wrapper keeps Metro from trying to resolve the URL at build time.
const runtimeImport = new Function('u', 'return import(u)') as (
  u: string,
) => Promise<typeof Vision>;

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

/**
 * Web capture adapter: getUserMedia front camera + MediaPipe BlazeFace
 * (on-device WASM) + ROI statistics. Each frame is drawn to an offscreen
 * canvas, reduced to mean skin colour inside the face box, then overwritten
 * by the next frame. Nothing is stored or sent anywhere (ADR 0003).
 */
export function CameraScanner({ active, onFrame, onStatus, size }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cb = useRef({ onFrame, onStatus });
  cb.current = { onFrame, onStatus };

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let detector: Vision.FaceDetector | null = null;
    let stopped = false;
    let handle = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        cb.current.onStatus('unavailable', 'This browser cannot access a camera.');
        return;
      }
      cb.current.onStatus('requesting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        cb.current.onStatus(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
          String(name),
        );
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      cb.current.onStatus('loading_detector');
      try {
        const { FaceDetector, FilesetResolver } = await runtimeImport(
          `${BASE}/mediapipe/vision_bundle.mjs`,
        );
        const fileset = await FilesetResolver.forVisionTasks(`${BASE}/mediapipe/wasm`);
        detector = await FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${BASE}/mediapipe/blaze_face_short_range.tflite`,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.6,
        });
      } catch (e) {
        cb.current.onStatus('error', `Face detector failed to load: ${String(e)}`);
        return;
      }
      if (stopped) return;
      cb.current.onStatus('running');

      let lastTs = -1;
      const tick = () => {
        if (stopped || !detector || !ctx) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        const now = performance.now();
        if (w && h && video.readyState >= 2 && now > lastTs) {
          lastTs = now;
          const det = detector.detectForVideo(video, now);
          const faces: FaceBox[] = det.detections
            .filter((d) => d.boundingBox)
            .map((d) => ({
              x: d.boundingBox!.originX,
              y: d.boundingBox!.originY,
              width: d.boundingBox!.width,
              height: d.boundingBox!.height,
            }));
          let roi = null;
          const f = faces[0];
          if (f) {
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w;
              canvas.height = h;
            }
            const x0 = Math.max(0, Math.floor(f.x));
            const y0 = Math.max(0, Math.floor(f.y));
            const x1 = Math.min(w, Math.ceil(f.x + f.width));
            const y1 = Math.min(h, Math.ceil(f.y + f.height));
            if (x1 - x0 > 8 && y1 - y0 > 8) {
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
              roi = extractRoi(
                { width: img.width, height: img.height, data: img.data, channels: 4 },
                { x: f.x - x0, y: f.y - y0, width: f.width, height: f.height },
              );
            }
          }
          cb.current.onFrame({ t: now, faces, roi, frameWidth: w, frameHeight: h });
        }
        const v = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        handle = v.requestVideoFrameCallback
          ? v.requestVideoFrameCallback(tick)
          : requestAnimationFrame(tick);
      };
      tick();
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(handle);
      stream?.getTracks().forEach((t) => t.stop());
      detector?.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      canvas.width = canvas.height = 0;
    };
  }, [active]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: '#000',
      }}
    >
      {createElement('video', {
        ref: videoRef,
        playsInline: true,
        muted: true,
        autoPlay: true,
        'aria-label': 'Camera preview',
        'data-testid': 'camera-video',
        style: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
      })}
    </View>
  );
}
