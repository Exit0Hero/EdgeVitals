import { useEffect } from 'react';
import { View } from 'react-native';
import { T } from '../components/ui';
import { colors } from '../theme/tokens';
import type { CameraScannerProps } from './types';

/**
 * Native capture adapter placeholder. The native frame-processor adapter
 * (VisionCamera + on-device face detection) is a separate milestone; until
 * it lands the scan reports the camera as unavailable instead of pretending
 * to measure.
 */
export function CameraScanner({ active, onStatus, size }: CameraScannerProps) {
  useEffect(() => {
    if (active)
      onStatus('unavailable', 'Camera scanning on this device is not available in this build yet.');
  }, [active, onStatus]);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.scanSurface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <T variant="small" color={colors.scanMuted}>
        Camera preview
      </T>
    </View>
  );
}
