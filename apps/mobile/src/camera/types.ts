import type { FrameInput } from '@edgevitals/measurement';

export type CameraStatus =
  'idle' | 'requesting' | 'loading_detector' | 'running' | 'denied' | 'unavailable' | 'error';

/** Diagnostic stages isolate camera output, ML Kit, and YUV sampling. */
export type CameraProcessingMode = 'full' | 'preview' | 'frames' | 'face';

export interface CameraScannerProps {
  /** Capture runs only while true; turning it off stops the camera and releases it. */
  active: boolean;
  /** Diagnostic mode: show the camera preview without frame output or face detection. */
  enableProcessing?: boolean;
  processingMode?: CameraProcessingMode;
  /** Called once per processed frame with aggregate statistics only (no pixels). */
  onFrame: (f: FrameInput) => void;
  onStatus: (s: CameraStatus, detail?: string) => void;
  /** Diameter of the circular preview in dp. */
  size: number;
}
