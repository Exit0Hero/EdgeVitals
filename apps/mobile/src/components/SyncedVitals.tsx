import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, type HealthSyncReading } from '../api/client';
import { formatSynced, sourceLabel } from '../lib/healthSync/mapping';
import { autoSyncHealth } from '../lib/healthSync/sync';
import { useSession } from '../state/session';
import { colors, space } from '../theme/tokens';
import { StatusPill, T, TextButton } from './ui';

/** How recent a device reading must be to sit next to a scan's results. */
const RECENT_HOURS = 24;

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return `${h} h ago`;
}

/**
 * Results: the newest SpO2 and blood pressure from the user's own devices
 * (Health Connect / Apple Health, ADR 0009), shown apart from camera values.
 * Renders nothing unless sync is on or recent synced readings exist.
 */
export function SyncedVitals() {
  const { me } = useSession();
  const syncOn = !!me?.consents.health_sync?.active;
  const [items, setItems] = useState<HealthSyncReading[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .healthSyncReadings(2)
        .then((r) => live && setItems(r.items))
        .catch(() => live && setItems([]));
    load();
    autoSyncHealth(me?.id, syncOn).then((s) => {
      if (s && (s.inserted || s.updated)) load();
    });
    return () => {
      live = false;
    };
  }, [me?.id, syncOn]);

  const since = Date.now() - RECENT_HOURS * 3_600_000;
  const latest = (metric: HealthSyncReading['metric']) =>
    (items ?? []).find((r) => r.metric === metric && Date.parse(r.measured_at) >= since);
  const rows = [latest('spo2'), latest('blood_pressure')].filter(
    (r): r is HealthSyncReading => !!r,
  );
  if (!items || (!rows.length && !syncOn)) return null;

  return (
    <View style={{ marginTop: space[4] }} testID="synced-vitals">
      <T variant="label" style={{ marginBottom: space[1] }}>
        From your devices
      </T>
      {rows.length ? (
        rows.map((r) => (
          <View
            key={r.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: space[3],
            }}
            testID={`synced-${r.metric}`}
          >
            <View style={{ flex: 1 }}>
              <T variant="body">{r.metric === 'spo2' ? 'SpO₂' : 'Blood pressure'}</T>
              <T variant="tiny" color={colors.muted}>
                {`${sourceLabel(r)} · ${ago(r.measured_at)}`}
              </T>
            </View>
            <T variant="label">{formatSynced(r)}</T>
            <StatusPill label="Your device" tone="muted" />
          </View>
        ))
      ) : (
        <T variant="small" color={colors.muted}>
          No SpO₂ or blood pressure from your health app in the last {RECENT_HOURS} hours.
        </T>
      )}
      <T variant="tiny" color={colors.muted} style={{ marginTop: space[1] }}>
        Recorded by your own device, not the EdgeVitals camera. Not part of your baseline or scores.
      </T>
      <TextButton
        label="See synced readings"
        align="flex-start"
        onPress={() => router.push('/health-readings')}
        testID="results-synced-readings"
      />
    </View>
  );
}
