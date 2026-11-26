import { View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';
import { T } from './ui';

/** Circular progress ring with a centred label (baseline 4/14, recovery 78). */
export function Ring({
  progress,
  size = 64,
  stroke = 6,
  label,
  labelSize = 15,
  accessibilityLabel,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  label: string;
  labelSize?: number;
  accessibilityLabel: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.primary}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * p} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View
        style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        <T variant="label" style={{ fontSize: labelSize, fontWeight: '800' }}>
          {label}
        </T>
      </View>
    </View>
  );
}

export interface ChartPoint {
  date: string;
  value: number | null;
}

/**
 * Line chart over daily points. Missing days break the line (no
 * interpolation that would suggest a measurement occurred, doc 09 §5).
 * The optional band is the personal usual range.
 */
export function LineChart({
  points,
  height = 110,
  width = 320,
  band,
  fill = true,
  summary,
}: {
  points: ChartPoint[];
  height?: number;
  width?: number;
  band?: { lower: number; upper: number } | null;
  fill?: boolean;
  summary: string;
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (!vals.length) {
    return (
      <View
        style={{
          height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.hero,
          borderRadius: 12,
        }}
        accessibilityLabel={summary}
      >
        <T variant="small" color={colors.muted}>
          No readings in this period yet
        </T>
      </View>
    );
  }
  const lo = Math.min(...vals, band?.lower ?? Infinity);
  const hi = Math.max(...vals, band?.upper ?? -Infinity);
  const pad = (hi - lo) * 0.15 || 5;
  const min = lo - pad;
  const max = hi + pad;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 8) + 4;
  const y = (v: number) => height - ((v - min) / (max - min)) * height;

  const segments: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur) segments.push(cur);
      cur = '';
      return;
    }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
  });
  if (cur) segments.push(cur);
  const last = [...points].reverse().find((p) => p.value !== null);
  const lastIdx = last ? points.lastIndexOf(last) : -1;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {band ? (
          <Rect
            x={0}
            y={y(band.upper)}
            width={width}
            height={Math.max(1, y(band.lower) - y(band.upper))}
            fill={colors.primarySoft}
          />
        ) : fill ? (
          <Rect x={0} y={0} width={width} height={height} fill={colors.hero} />
        ) : null}
        {band ? (
          <Line
            x1={0}
            x2={width}
            y1={y((band.lower + band.upper) / 2)}
            y2={y((band.lower + band.upper) / 2)}
            stroke={colors.primary}
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />
        ) : null}
        {segments.map((d, i) => (
          <Path
            key={i}
            d={d}
            stroke={colors.primary}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) =>
          p.value !== null && (segments.length > 1 || vals.length < 3) ? (
            <Circle key={i} cx={x(i)} cy={y(p.value)} r={2.2} fill={colors.primary} />
          ) : null,
        )}
        {last && lastIdx >= 0 ? (
          <Circle
            cx={x(lastIdx)}
            cy={y(last.value!)}
            r={4}
            fill={colors.primary}
            stroke={colors.white}
            strokeWidth={1.5}
          />
        ) : null}
      </Svg>
    </View>
  );
}
