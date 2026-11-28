import type { RelativeStatus } from '@edgevitals/domain';
import { View } from 'react-native';
import { METRIC_SHORT, METRIC_UNIT, REASON_COPY, relativeLabel } from '../lib/format';
import { colors, radius, space } from '../theme/tokens';
import { StatusPill, T } from './ui';

export interface VitalValue {
  metric: string;
  status: string;
  value: number | null;
  /** Diastolic, for blood pressure. */
  value_secondary?: number | null;
  /** licensed_sdk marks a vendor wellness estimate (ADR 0007). */
  method?: string | null;
  relative?: RelativeStatus;
  reason?: string | null;
}

const ORDER = ['heart_rate', 'hrv', 'breathing_rate', 'spo2', 'blood_pressure'];
export const sortVitals = <V extends { metric: string }>(v: V[]) =>
  [...v].sort((a, b) => ORDER.indexOf(a.metric) - ORDER.indexOf(b.metric));

function display(v: VitalValue): { main: string; unit: string | null; note: string | null } {
  const bpPair = v.metric === 'blood_pressure';
  if (
    v.value !== null &&
    (v.status === 'valid' || v.status === 'simulated') &&
    (!bpPair || v.value_secondary != null)
  ) {
    return {
      main: bpPair
        ? `${Math.round(v.value)}/${Math.round(v.value_secondary!)}`
        : String(Math.round(v.value)),
      unit: METRIC_UNIT[v.metric] ?? null,
      note:
        v.status === 'simulated'
          ? 'Demo data'
          : v.method === 'licensed_sdk'
            ? 'Wellness estimate'
            : v.method === 'camera_experimental'
              ? 'Experimental'
              : v.method === 'finger_ppg'
                ? 'Finger scan'
                : null,
    };
  }
  const unsupported =
    (v.metric === 'spo2' || v.metric === 'blood_pressure') &&
    v.method !== 'licensed_sdk' &&
    v.method !== 'camera_experimental';
  return {
    main: '—',
    unit: null,
    note: unsupported ? 'Not available' : (REASON_COPY[v.reason ?? ''] ?? 'No reliable reading'),
  };
}

/** Grid of tiles used for "Last assessment" (PDF page 5). */
export function VitalTiles({ vitals, testID }: { vitals: VitalValue[]; testID?: string }) {
  const sorted = sortVitals(vitals);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }} testID={testID}>
      {sorted.map((v, i) => {
        const d = display(v);
        const wide = i >= 3;
        return (
          <View
            key={v.metric}
            accessible
            accessibilityLabel={`${METRIC_SHORT[v.metric]}: ${d.main === '—' ? d.note : `${d.main} ${d.unit ?? ''}`}`}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.small + 2,
              padding: space[3],
              flexBasis: wide ? (i === 3 ? '31%' : '64%') : '31%',
              flexGrow: 1,
            }}
            testID={`vital-${v.metric}`}
          >
            <T variant="tiny" color={colors.muted} style={{ fontSize: 12 }}>
              {METRIC_SHORT[v.metric]}
            </T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
              <T variant="heading" style={{ fontSize: 17 }}>
                {d.main}
              </T>
              {d.unit ? (
                <T variant="tiny" color={colors.muted}>
                  {d.unit}
                </T>
              ) : null}
            </View>
            {d.note ? (
              <T variant="tiny" color={colors.muted}>
                {d.note}
              </T>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Row list used on results (PDF page 9): name, value, personal status tag. */
export function VitalRows({ vitals }: { vitals: VitalValue[] }) {
  return (
    <View>
      {sortVitals(vitals).map((v, i, all) => {
        const d = display(v);
        const rel = v.relative ? relativeLabel(v.relative) : null;
        return (
          <View
            key={v.metric}
            accessible
            accessibilityLabel={`${METRIC_SHORT[v.metric] === 'Breathing' ? 'Breathing rate' : METRIC_SHORT[v.metric]}: ${
              d.main === '—' ? d.note : `${d.main} ${d.unit ?? ''}${rel ? `, ${rel.label}` : ''}`
            }`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderBottomWidth: i === all.length - 1 ? 0 : 1,
              borderBottomColor: colors.border,
            }}
            testID={`row-${v.metric}`}
          >
            <T variant="body" style={{ flex: 1 }}>
              {v.metric === 'breathing_rate' ? 'Breathing rate' : METRIC_SHORT[v.metric]}
            </T>
            {d.main === '—' ? (
              <T variant="small" color={colors.muted}>
                {d.note}
              </T>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <T variant="label" style={{ fontSize: 16, fontWeight: '700' }}>
                  {d.main}
                </T>
                <T variant="tiny" color={colors.muted}>
                  {d.unit}
                </T>
              </View>
            )}
            <View style={{ minWidth: 92, marginLeft: space[2], alignItems: 'flex-end' }}>
              {d.note === 'Demo data' ? (
                <StatusPill label="Demo" tone="muted" />
              ) : d.note === 'Wellness estimate' ? (
                <StatusPill label="Estimate" tone="muted" />
              ) : d.note === 'Experimental' ? (
                <StatusPill label="Experimental" tone="warning" />
              ) : rel && d.main !== '—' ? (
                <StatusPill label={rel.label} tone={rel.tone} />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Compact chips for "This morning's vitals" (PDF page 10). */
export function VitalChips({ vitals }: { vitals: VitalValue[] }) {
  const short: Record<string, string> = {
    heart_rate: 'HR',
    hrv: 'PRV',
    breathing_rate: 'Breathing',
    spo2: 'SpO₂',
    blood_pressure: 'BP',
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {sortVitals(vitals).map((v) => {
        const d = display(v);
        const dot =
          v.relative === 'higher' || v.relative === 'lower'
            ? colors.warning
            : d.main === '—'
              ? colors.subtle
              : colors.primary;
        return (
          <View
            key={v.metric}
            accessible
            accessibilityLabel={`${short[v.metric]} ${d.main === '—' ? d.note : `${d.main}${d.unit ?? ''}`}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: colors.surface,
              borderRadius: radius.small + 2,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
            <T variant="body" color={colors.textSecondary}>
              {short[v.metric]}
            </T>
            <T variant="label">
              {d.main === '—'
                ? d.note === 'Not available'
                  ? 'n/a'
                  : '—'
                : `${d.main}${v.metric === 'breathing_rate' ? '/min' : v.metric === 'spo2' ? '%' : ` ${d.unit}`}`}
            </T>
          </View>
        );
      })}
    </View>
  );
}
