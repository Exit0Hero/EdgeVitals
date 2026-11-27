/**
 * Building blocks for the face and finger scan screens (docs/spec/15_DESIGN_SYSTEM.md §7):
 * dark background, clear cancel control, camera preview, honest quality state,
 * measurement progress sheet and per-metric statuses.
 *
 * Display only. Every value passed in comes from the live scan session; these
 * components never invent progress, countdowns or readings.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { colors, MIN_TOUCH, radius, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { T } from './ui';

/** Quality tone: `ok` once the frames pass the live checks, `warn` while one fails. */
export type ScanTone = 'idle' | 'ok' | 'warn';

const TONE_COLOR: Record<ScanTone, string> = {
  idle: colors.scanAccent,
  ok: colors.scanOk,
  warn: colors.scanWarn,
};

export const formatElapsed = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec) % 60).padStart(2, '0')}`;

/** Cancel pill on the left, scan name and current instruction in the middle. */
export function ScanTopBar({
  eyebrow,
  title,
  onCancel,
  cancelTestID,
}: {
  eyebrow: string;
  title: string;
  onCancel: () => void;
  cancelTestID: string;
}) {
  return (
    <View
      style={{
        minHeight: 56,
        justifyContent: 'center',
        paddingHorizontal: space[4],
      }}
    >
      <View style={{ position: 'absolute', left: 88, right: 88, alignItems: 'center' }}>
        <T variant="tiny" color={colors.scanMuted} style={{ letterSpacing: 0.6 }}>
          {eyebrow.toUpperCase()}
        </T>
        <T
          variant="label"
          color={colors.scanText}
          style={{ fontSize: 17, textAlign: 'center' }}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </T>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel scan"
        onPress={onCancel}
        hitSlop={8}
        testID={cancelTestID}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: MIN_TOUCH - 4,
          paddingLeft: 10,
          paddingRight: 14,
          borderRadius: radius.pill,
          backgroundColor: colors.scanSurface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="close" size={16} color={colors.scanText} strokeWidth={2.4} />
        <T variant="label" color={colors.scanText} style={{ fontSize: 14 }}>
          Cancel
        </T>
      </Pressable>
    </View>
  );
}

/**
 * Circular camera frame whose arc fills with the share of clean signal
 * captured so far (the session's real `progress`), coloured by quality.
 */
export function ProgressRing({
  size,
  progress,
  tone,
  children,
}: {
  /** Diameter of the camera preview inside the ring. */
  size: number;
  progress: number;
  tone: ScanTone;
  children: ReactNode;
}) {
  const stroke = 6;
  const gap = 8;
  const outer = size + 2 * (gap + stroke);
  const r = (outer - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={outer}
        height={outer}
        style={{ position: 'absolute' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Circle
          cx={outer / 2}
          cy={outer / 2}
          r={r}
          stroke={colors.scanTrack}
          strokeWidth={stroke}
          fill="none"
        />
        {p > 0 ? (
          <Circle
            cx={outer / 2}
            cy={outer / 2}
            r={r}
            stroke={TONE_COLOR[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - p)}
            rotation={-90}
            origin={`${outer / 2}, ${outer / 2}`}
            fill="none"
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** Dashed face guide drawn over the front-camera preview. */
export function FaceGuide({ size, tone }: { size: number; tone: ScanTone }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size}>
        <Ellipse
          cx={size / 2}
          cy={size * 0.47}
          rx={size * 0.3}
          ry={size * 0.38}
          stroke={tone === 'idle' ? 'rgba(255,255,255,0.75)' : TONE_COLOR[tone]}
          strokeWidth={2.5}
          strokeDasharray={tone === 'ok' ? undefined : '7 6'}
          fill="none"
        />
      </Svg>
    </View>
  );
}

/**
 * Current guidance in a pill with a status dot. Announced to screen readers
 * when it changes: a live region on Android and web, an explicit
 * announcement on iOS (which has no live regions).
 */
export function QualityStatus({
  text,
  hint,
  tone,
  testID,
}: {
  text: string;
  hint?: string | null;
  tone: ScanTone;
  testID: string;
}) {
  const last = useRef('');
  const full = hint ? `${text} ${hint}` : text;
  useEffect(() => {
    if (Platform.OS !== 'ios' || !full || full === last.current) return;
    last.current = full;
    AccessibilityInfo.announceForAccessibility(full);
  }, [full]);
  return (
    <View
      accessibilityLiveRegion="polite"
      aria-live="polite"
      style={{ minHeight: 44, paddingHorizontal: space[5], alignItems: 'center', gap: 6 }}
    >
      {text ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            backgroundColor: colors.scanSurface,
            borderRadius: radius.control,
            paddingVertical: 10,
            paddingHorizontal: space[4],
            maxWidth: 420,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: TONE_COLOR[tone],
            }}
          />
          <T
            variant="body"
            color={tone === 'warn' ? colors.scanWarn : colors.scanText}
            style={{ flexShrink: 1 }}
            testID={testID}
          >
            {text}
          </T>
        </View>
      ) : (
        <T variant="body" color={colors.scanText} testID={testID}>
          {''}
        </T>
      )}
      {hint ? (
        <T variant="small" color={colors.scanWarn} style={{ textAlign: 'center' }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Inline problem message on the dark background (save failed, scan interrupted). */
export function ScanNotice({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: space[5],
        padding: space[4],
        gap: space[3],
        borderRadius: radius.control,
        backgroundColor: colors.scanSurface,
        borderLeftWidth: 3,
        borderLeftColor: colors.scanWarn,
      }}
    >
      <T variant="body" color={colors.scanText}>
        {message}
      </T>
      {children}
    </View>
  );
}

/** White measurement sheet docked to the bottom of the scan screen. */
export function ScanSheet({ children, testID }: { children: ReactNode; testID: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.white,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: space[5],
        paddingTop: space[3],
        paddingBottom: Math.max(insets.bottom, space[4]),
        gap: space[3],
      }}
    >
      <View
        style={{
          alignSelf: 'center',
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
        }}
      />
      {children}
    </View>
  );
}

export function SheetHeader({
  title,
  subtitle,
  elapsedSec,
  elapsedTestID,
}: {
  title: string;
  subtitle?: string;
  elapsedSec: number;
  elapsedTestID?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
      <View style={{ flex: 1 }}>
        <T variant="heading" style={{ fontSize: 17 }}>
          {title}
        </T>
        {subtitle ? (
          <T variant="small" color={colors.muted}>
            {subtitle}
          </T>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.pill,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
        accessible
        accessibilityLabel={`Elapsed ${formatElapsed(elapsedSec)}`}
      >
        <T
          variant="label"
          color={colors.textSecondary}
          style={{ fontSize: 14, fontVariant: ['tabular-nums'] }}
          testID={elapsedTestID}
        >
          {formatElapsed(elapsedSec)}
        </T>
      </View>
    </View>
  );
}

/** Clean-signal progress bar with its real seconds count. */
export function SignalProgress({
  progress,
  usableSec,
  targetSec,
  fillTestID,
}: {
  progress: number;
  usableSec: number | null;
  targetSec: number;
  fillTestID?: string;
}) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space[1] }}
      >
        <T variant="small" color={colors.textSecondary}>
          Clean signal
        </T>
        <T variant="small" color={colors.textSecondary} style={{ fontVariant: ['tabular-nums'] }}>
          {usableSec === null
            ? `${targetSec} s needed`
            : `${Math.floor(usableSec)} of ${targetSec} s`}
        </T>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Clean signal captured"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}
        style={{
          height: 8,
          backgroundColor: colors.surface,
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${p * 100}%`,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.primary,
          }}
          testID={fillTestID}
        />
      </View>
    </View>
  );
}

export type TileState = 'waiting' | 'measuring' | 'unsupported' | 'no_reading';

const STATE_TEXT: Record<TileState, string> = {
  waiting: 'Waiting…',
  measuring: 'Measuring…',
  unsupported: 'Not supported yet',
  no_reading: 'No reliable reading',
};

/** One vital sign in the measurement sheet: interim value once it exists, else its status. */
export function MetricTile({
  icon,
  label,
  value,
  unit,
  state,
  compact,
  testID,
}: {
  icon: IconName;
  label: string;
  value: number | null | undefined;
  unit: string;
  state: TileState;
  /** One-line layout for metrics the camera cannot measure. */
  compact?: boolean;
  testID: string;
}) {
  const has = value != null;
  const dim = state === 'unsupported' || state === 'no_reading';
  const status = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {state === 'measuring' && !has ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
      ) : null}
      <T variant="small" color={state === 'measuring' ? colors.primary : colors.muted}>
        {STATE_TEXT[state]}
      </T>
    </View>
  );
  if (compact)
    return (
      <View
        testID={testID}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          borderRadius: radius.small,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space[3],
          paddingVertical: 8,
        }}
      >
        <Icon name={icon} size={16} color={colors.subtle} />
        <View style={{ flex: 1 }}>
          <T variant="small" color={colors.textSecondary}>
            {label}
          </T>
          <T variant="tiny" color={colors.muted}>
            {STATE_TEXT[state]}
          </T>
        </View>
      </View>
    );
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        backgroundColor: has ? colors.primarySoft : colors.surface,
        borderRadius: radius.control,
        padding: space[3],
        minHeight: 84,
        justifyContent: 'space-between',
        opacity: dim ? 0.85 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={16} color={has ? colors.primary : colors.subtle} />
        <T variant="tiny" color={colors.textSecondary} style={{ fontSize: 12 }}>
          {label}
        </T>
      </View>
      {has ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
          <T variant="metric" style={{ fontVariant: ['tabular-nums'] }}>
            {String(value)}
          </T>
          <T variant="tiny" color={colors.muted}>
            {unit}
          </T>
        </View>
      ) : (
        status
      )}
    </View>
  );
}

/** Live pulse-signal strength (face scan). Same thresholds as before: ≥3 dB strong, ≥−2 dB fair. */
export function SignalMeter({ snrDb }: { snrDb: number | null }) {
  if (snrDb === null) return null;
  const level = snrDb >= 3 ? 3 : snrDb >= -2 ? 2 : 1;
  const label = level === 3 ? 'strong' : level === 2 ? 'fair' : 'weak';
  const color = level === 3 ? colors.success : level === 2 ? colors.primary : colors.warning;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
      accessible
      accessibilityLabel={`Pulse signal ${label}, ${snrDb.toFixed(1)} decibels`}
      testID="scan-signal-meter"
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {[6, 10, 14].map((h, i) => (
          <View
            key={h}
            style={{
              width: 4,
              height: h,
              borderRadius: 1,
              backgroundColor: i < level ? color : colors.border,
            }}
          />
        ))}
      </View>
      <T variant="small" color={colors.textSecondary}>
        Pulse signal{' '}
        <T variant="small" color={color} style={{ fontWeight: '700' }}>
          {label}
        </T>{' '}
        ({snrDb.toFixed(1)} dB)
      </T>
    </View>
  );
}

/** Full-screen camera problem (permission off, no camera, start-up failure). */
export function CameraProblem({
  title,
  body,
  testID,
  children,
}: {
  title: string;
  body: string;
  testID: string;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, padding: space[6], justifyContent: 'center' }} testID={testID}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.scanSurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space[5],
        }}
      >
        <Icon name="camera" color={colors.scanAccent} size={32} />
      </View>
      <T variant="title" color={colors.scanText} style={{ marginBottom: space[2] }}>
        {title}
      </T>
      <T variant="body" color={colors.scanMuted} style={{ marginBottom: space[6] }}>
        {body}
      </T>
      <View style={{ gap: space[2] }}>{children}</View>
    </View>
  );
}
