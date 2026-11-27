import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError, type HealthSyncReading } from '../api/client';
import {
  BackHeader,
  ErrorState,
  Loading,
  Screen,
  Segmented,
  StatusPill,
  T,
} from '../components/ui';
import { formatSynced, sourceLabel } from '../lib/healthSync/mapping';
import { colors, space } from '../theme/tokens';

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Readings copied from Health Connect / Apple Health (ADR 0009), each with its source. */
export default function HealthReadings() {
  const [metric, setMetric] = useState<'all' | 'spo2' | 'blood_pressure'>('all');
  const [items, setItems] = useState<HealthSyncReading[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    api
      .healthSyncReadings(90, metric === 'all' ? undefined : metric)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load readings'));
  }, [metric]);
  useEffect(load, [load]);

  return (
    <Screen testID="screen-health-readings">
      <BackHeader title="Synced readings" onBack={() => router.back()} />
      <T variant="body" color={colors.textSecondary} style={{ marginBottom: space[4] }}>
        Copied from your health app in the last 90 days. They come from your own devices, not the
        EdgeVitals camera, and are shown exactly as those devices recorded them.
      </T>
      <Segmented
        label="Show"
        value={metric}
        onChange={setMetric}
        options={[
          { value: 'all', label: 'All' },
          { value: 'spo2', label: 'SpO₂' },
          { value: 'blood_pressure', label: 'Blood pressure' },
        ]}
      />
      <View style={{ height: space[3] }} />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items === null ? (
        <Loading label="Loading readings" />
      ) : items.length === 0 ? (
        <T variant="small" color={colors.muted} testID="health-readings-empty">
          No synced readings yet. Turn on health app sync in Settings.
        </T>
      ) : (
        items.map((r) => (
          <View
            key={r.id}
            testID="health-reading-row"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: space[3],
            }}
          >
            <View style={{ flex: 1 }}>
              <T variant="label">{`${r.metric === 'spo2' ? 'SpO₂' : 'Blood pressure'} · ${formatSynced(r)}`}</T>
              <T variant="small" color={colors.muted}>
                {`${when(r.measured_at)} · ${sourceLabel(r)}`}
              </T>
            </View>
            <StatusPill label="Your device" tone="muted" />
          </View>
        ))
      )}
      <T variant="small" color={colors.muted} style={{ marginTop: space[5] }}>
        Wellness information only, not for diagnosis. To change or remove a reading at its source,
        use the app that recorded it. You can delete all copies in Settings.
      </T>
    </Screen>
  );
}
