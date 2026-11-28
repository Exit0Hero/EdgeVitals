import { View } from 'react-native';
import {
  LOW_CONFIDENCE_COPY,
  METRIC_LONG,
  missingExplanation,
  type MissingVital,
} from '../lib/format';
import { colors, space } from '../theme/tokens';
import { sortVitals } from './vitals';
import { Card, T } from './ui';

const PULSE_METRICS = ['heart_rate', 'hrv', 'breathing_rate'];

function joinNames(names: string[]) {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Results: one plain line for each vital that has no value, saying why and
 * what to do, so no row is left as an unexplained dash. When heart rate fails,
 * PRV and breathing (which depend on the same pulse) share its line.
 */
export function MissingVitals({
  vitals,
  fingerScan,
}: {
  vitals: MissingVital[];
  fingerScan: boolean;
}) {
  const heartRateValid = vitals.some((v) => v.metric === 'heart_rate' && v.status === 'valid');
  const heartRateLowConfidence = vitals.some(
    (v) =>
      v.metric === 'heart_rate' &&
      v.status === 'valid' &&
      !!v.quality_flags?.includes('low_confidence'),
  );
  const missing = sortVitals(vitals).filter((v) => v.status !== 'valid');
  const items: { key: string; label: string; body: string }[] = [];
  for (const v of missing) {
    const body = missingExplanation(v, { heartRateValid, fingerScan, heartRateLowConfidence });
    if (!body) continue;
    const label =
      v.metric === 'heart_rate'
        ? joinNames(
            missing
              .filter(
                (m) =>
                  PULSE_METRICS.includes(m.metric) &&
                  // Breathing from head movement can pass without a heart rate.
                  (m.metric !== 'breathing_rate' || m.reason !== 'insufficient_duration'),
              )
              .map((m) => METRIC_LONG[m.metric] ?? m.metric),
          )
        : (METRIC_LONG[v.metric] ?? v.metric);
    items.push({ key: v.metric, label, body });
  }
  for (const v of sortVitals(vitals))
    if (
      v.status === 'valid' &&
      v.quality_flags?.includes('low_confidence') &&
      LOW_CONFIDENCE_COPY[v.metric]
    )
      items.unshift({
        key: `low-${v.metric}`,
        label: `${METRIC_LONG[v.metric] ?? v.metric}: low confidence`,
        body: LOW_CONFIDENCE_COPY[v.metric]!,
      });
  if (!items.length) return null;
  return (
    <Card tone="surface" testID="missing-vitals" style={{ marginBottom: space[5] }}>
      <T variant="label" style={{ marginBottom: space[2] }}>
        {items.some((i) => i.key.startsWith('low-'))
          ? 'About these readings'
          : 'Why some vitals have no value'}
      </T>
      {items.map((it) => (
        <View key={it.key} style={{ marginBottom: space[2] }} testID={`missing-${it.key}`}>
          <T variant="small" style={{ fontWeight: '600' }}>
            {it.label}
          </T>
          <T variant="small" color={colors.textSecondary}>
            {it.body}
          </T>
        </View>
      ))}
    </Card>
  );
}
