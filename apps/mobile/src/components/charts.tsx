import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
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

/** Smooth path through points (Catmull-Rom as cubic Béziers, tension 0.5, clamped to the chart). */
function smoothPath(pts: [number, number][], h: number): string {
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const c = (v: number) => Math.max(0, Math.min(h, v));
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = c(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = c(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

let gradientSeq = 0;

/**
 * Line chart over daily points. Missing days break the line (no
 * interpolation that would suggest a measurement occurred, doc 09 §5): each
 * run of consecutive readings is drawn as its own smoothed segment.
 * The optional band is the personal usual range. The y axis is padded so
 * that day-to-day noise is not stretched to the full chart height.
 */
export function LineChart({
  points,
  height = 110,
  width = 320,
  band,
  fill = true,
  summary,
  showScale = true,
}: {
  points: ChartPoint[];
  height?: number;
  width?: number;
  band?: { lower: number; upper: number } | null;
  fill?: boolean;
  summary: string;
  showScale?: boolean;
}) {
  const [gid] = useState(() => `evg${++gradientSeq}`);
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
  // Scale to at least a third of the level so day-to-day wobbles stay small.
  const span = Math.max(hi - lo, Math.abs((hi + lo) / 2) * 0.35, 4);
  const mid = (hi + lo) / 2;
  const min = mid - span * 0.65;
  const max = mid + span * 0.65;
  const top = 8;
  const bottom = 6;
  const plotH = height - top - bottom;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 12) + 6;
  const y = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;

  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length) runs.push(cur);
      cur = [];
      return;
    }
    cur.push([x(i), y(p.value)]);
  });
  if (cur.length) runs.push(cur);
  const last = [...points].reverse().find((p) => p.value !== null);
  const lastIdx = last ? points.lastIndexOf(last) : -1;
  const grid = [0.25, 0.5, 0.75].map((f) => top + f * plotH);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={0.22} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {grid.map((gy) => (
          <Line
            key={gy}
            x1={0}
            x2={width}
            y1={gy}
            y2={gy}
            stroke={colors.border}
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
        {band ? (
          <Rect
            x={0}
            y={y(band.upper)}
            width={width}
            height={Math.max(1, y(band.lower) - y(band.upper))}
            fill={colors.primarySoft}
            opacity={0.9}
          />
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
        {fill
          ? runs
              .filter((r) => r.length > 1)
              .map((r, i) => (
                <Path
                  key={`a${i}`}
                  d={`${smoothPath(r, height)} L${r[r.length - 1]![0].toFixed(1)},${height} L${r[0]![0].toFixed(1)},${height} Z`}
                  fill={`url(#${gid})`}
                />
              ))
          : null}
        {runs.map((r, i) => (
          <Path
            key={i}
            d={smoothPath(r, height)}
            stroke={colors.primary}
            strokeWidth={2.4}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {runs
          .filter((r) => r.length === 1)
          .map((r, i) => (
            <Circle key={`s${i}`} cx={r[0]![0]} cy={r[0]![1]} r={2.6} fill={colors.primary} />
          ))}
        {last && lastIdx >= 0 ? (
          <Circle
            cx={x(lastIdx)}
            cy={y(last.value!)}
            r={4.5}
            fill={colors.primary}
            stroke={colors.white}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {showScale ? (
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <T variant="tiny" color={colors.muted}>
            {shortDate(points[0]?.date)}
          </T>
          <T variant="tiny" color={colors.muted}>
            {`${fmt(Math.min(...vals))}–${fmt(Math.max(...vals))}`}
          </T>
          <T variant="tiny" color={colors.muted}>
            {shortDate(points[points.length - 1]?.date)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}
