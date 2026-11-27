import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { T } from '../components/ui';
import { colors } from '../theme/tokens';
import type { FingerCameraProps } from './FingerCamera';

/**
 * The finger scan needs the phone's back camera and flash, which browsers
 * cannot reliably switch on. On the web it reports itself unavailable so the
 * screen offers the face scan instead.
 */
export function FingerCamera({ active, onStatus, size }: FingerCameraProps) {
  const cb = useRef(onStatus);
  cb.current = onStatus;
  useEffect(() => {
    if (active)
      cb.current(
        'unavailable',
        'The finger scan needs the EdgeVitals app on a phone with a flash. Use the face scan here.',
      );
  }, [active]);
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
        Camera
      </T>
    </View>
  );
}
