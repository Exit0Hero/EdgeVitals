import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

/**
 * Pulse waveform line (samples scaled to ±1), with optional beat marks.
 * Display only: the values shown are the measured signal, never redrawn or
 * idealised.
 */
export function PulseWave({
  samples,
  width,
  height,
  color = colors.primary,
  beats,
  fs,
  testID,
  accessibilityLabel,
}: {
  samples: number[];
  width: number;
  height: number;
  color?: string;
  /** Beat times in seconds from the first sample (needs fs). */
  beats?: number[];
  fs?: number;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const n = samples.length;
  const mid = height / 2;
  const amp = height * 0.42;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * width : 0);
  let d = '';
  for (let i = 0; i < n; i++) {
    d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(mid - samples[i]! * amp).toFixed(1)}`;
  }
  const marks =
    beats && fs && n > 1
      ? beats
          .map((t) => Math.round(t * fs))
          .filter((i) => i >= 0 && i < n)
          .map((i) => ({ cx: x(i), cy: mid - samples[i]! * amp }))
      : [];
  return (
    <View
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={{ width, height }}
    >
      <Svg width={width} height={height}>
        {n > 1 ? <Path d={d} stroke={color} strokeWidth={2} fill="none" /> : null}
        {marks.map((m, i) => (
          <Circle key={i} cx={m.cx} cy={m.cy} r={3} fill={colors.text} />
        ))}
      </Svg>
    </View>
  );
}
