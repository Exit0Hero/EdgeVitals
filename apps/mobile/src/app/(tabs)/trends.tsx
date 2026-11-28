import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError, type Trends as TrendsData } from '../../api/client';
import { LineChart } from '../../components/charts';
import { Icon } from '../../components/Icon';
import { Card, ErrorState, Loading, Segmented, StatusPill, T } from '../../components/ui';
import { relativeLabel } from '../../lib/format';
import { sourceLabel } from '../../lib/healthSync/mapping';
import { autoSyncHealth } from '../../lib/healthSync/sync';
import { useSession } from '../../state/session';
import { colors, radius, space } from '../../theme/tokens';

const METRICS = [
  { id: 'recovery', label: 'Recovery', title: 'Recovery', unit: '' },
  { id: 'stress', label: 'Stress', title: 'Stress', unit: '' },
  { id: 'energy', label: 'Energy', title: 'Energy', unit: '' },
  { id: 'hrv', label: 'HRV', title: 'HRV · morning scans', unit: 'ms' },
  { id: 'heart_rate', label: 'Heart rate', title: 'Heart rate · morning scans', unit: 'bpm' },
  {
    id: 'breathing_rate',
    label: 'Breathing',
    title: 'Breathing rate · morning scans',
    unit: '/min',
  },
] as const;
type MetricId = (typeof METRICS)[number]['id'];
type Period = '7d' | '30d' | '90d';
const PERIOD_LABEL: Record<Period, string> = { '7d': '7-day', '30d': '30-day', '90d': '90-day' };

/** PDF page 12 — Trends. */
export default function Trends() {
  const [metric, setMetric] = useState<MetricId>('hrv');
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { me } = useSession();
  const syncOn = !!me?.consents.health_sync?.active;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.trends(metric, period));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load trends');
    } finally {
      setLoading(false);
    }
  }, [metric, period]);
  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
      // Pull new readings from Health Connect / Apple Health, then refresh if any arrived.
      autoSyncHealth(me?.id, syncOn).then((s) => {
        if (s && (s.inserted || s.updated)) load();
      });
    }, [load, me?.id, syncOn]),
  );

  const m = METRICS.find((x) => x.id === metric)!;
  const avg =
    data?.average !== null && data?.average !== undefined ? Math.round(data.average) : null;
  const isScore = metric === 'recovery' || metric === 'stress' || metric === 'energy';
  const rhr = data?.summaries.resting_heart_rate;
  const rhrTag = rhr ? relativeLabel(rhr.relative) : null;
  // Newest blood pressure in the period: cuff, health app or licensed SDK.
  const bp = data?.summaries.blood_pressure;
  // Newest SpO2: the user's own devices via their health app (ADR 0009), or
  // the opt-in experimental face-scan estimate (ADR 0008).
  const spo2 = data?.summaries.spo2 ?? null;
  const spo2Camera = spo2?.source === 'camera_experimental';
  const bpSource =
    bp?.source === 'cuff'
      ? 'Typed in from your cuff'
      : bp?.source_detail
        ? sourceLabel(bp.source_detail)
        : bp?.value != null
          ? 'Licensed camera SDK estimate'
          : null;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.white }}
      edges={['top']}
      testID="screen-trends"
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[8] }}>
        <T
          variant="title"
          accessibilityRole="header"
          style={{ marginTop: space[3], marginBottom: space[4] }}
        >
          Trends
        </T>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space[2] }}
          accessibilityRole="tablist"
          style={{ marginBottom: space[4], marginHorizontal: -space[5] }}
        >
          <View style={{ width: space[5] - space[2] }} />
          {METRICS.map((x) => {
            const sel = x.id === metric;
            return (
              <Pressable
                key={x.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: sel }}
                aria-selected={sel}
                onPress={() => setMetric(x.id)}
                testID={`metric-${x.id}`}
                style={{
                  paddingHorizontal: 16,
                  minHeight: 40,
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: sel ? colors.text : colors.border,
                  backgroundColor: sel ? colors.text : colors.white,
                }}
              >
                <T
                  variant="label"
                  color={sel ? colors.white : colors.text}
                  style={{ fontSize: 14, fontWeight: sel ? '700' : '500' }}
                >
                  {x.label}
                </T>
              </Pressable>
            );
          })}
          <View style={{ width: space[3] }} />
        </ScrollView>
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
            { value: '90d', label: '90 days' },
          ]}
          testID="period"
        />

        {!data && loading ? <Loading /> : null}
        {error && !data ? <ErrorState message={error} onRetry={load} /> : null}
        {data ? (
          <View style={{ marginTop: space[5] }} testID="trend-body">
            <T variant="small" color={colors.muted}>
              {m.title}
            </T>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: 6,
                marginBottom: space[3],
              }}
            >
              <T variant="metricLarge" testID="trend-average">
                {avg !== null ? `${avg}${m.unit ? ` ${m.unit}` : ''}` : '—'}
              </T>
              <T variant="small" color={colors.muted}>
                {avg !== null
                  ? `${PERIOD_LABEL[period]} average`
                  : isScore
                    ? 'Scores unlock on day 14'
                    : 'No readings yet'}
              </T>
            </View>
            <LineChart
              points={data.points}
              band={data.usualRange}
              height={120}
              summary={`${m.label} over ${PERIOD_LABEL[period]}: ${data.sampleCount} readings, ${data.missingDays} days without a reading${avg !== null ? `, average ${avg}` : ''}${
                data.usualRange
                  ? `, usual range ${Math.round(data.usualRange.lower)} to ${Math.round(data.usualRange.upper)}`
                  : ''
              }.`}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                marginTop: space[3],
              }}
            >
              {data.usualRange ? (
                <>
                  <View
                    style={{
                      width: 14,
                      height: 10,
                      backgroundColor: colors.primarySoft,
                      borderWidth: 1,
                      borderColor: '#BFD2F7',
                    }}
                  />
                  <T variant="small" color={colors.textSecondary}>
                    Your usual range {Math.round(data.usualRange.lower)}–
                    {Math.round(data.usualRange.upper)}
                    {m.unit ? ` ${m.unit}` : ''}
                  </T>
                </>
              ) : (
                <T variant="small" color={colors.muted}>
                  {isScore
                    ? 'Scores are compared with your own baseline.'
                    : 'Your usual range appears once your baseline is ready.'}
                </T>
              )}
            </View>
            <T
              variant="tiny"
              color={colors.muted}
              style={{ marginTop: space[1] }}
              testID="sample-count"
            >
              {data.sampleCount} {data.sampleCount === 1 ? 'reading' : 'readings'} ·{' '}
              {data.missingDays} {data.missingDays === 1 ? 'day' : 'days'} without one (gaps are not
              filled in)
            </T>

            {data.insight ? (
              <Card
                tone="soft"
                style={{ flexDirection: 'row', gap: space[3], marginTop: space[5] }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.white,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="shield" size={18} />
                </View>
                <T variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                  {data.insight.body}
                </T>
              </Card>
            ) : null}

            <View style={{ marginTop: space[5] }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <T variant="body" style={{ flex: 1 }}>
                  Resting heart rate
                </T>
                <T variant="label" style={{ width: 80, textAlign: 'right' }}>
                  {rhr?.value != null ? `${rhr.value} bpm` : '—'}
                </T>
                <View style={{ width: 90, alignItems: 'flex-end' }}>
                  {rhrTag && rhr?.value != null ? (
                    <StatusPill label={rhrTag.label} tone={rhrTag.tone} />
                  ) : null}
                </View>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <T variant="body">Blood pressure</T>
                  {bpSource && bp?.value != null ? (
                    <T variant="tiny" color={colors.muted} testID="bp-source">
                      {bpSource}
                    </T>
                  ) : null}
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push('/blood-pressure')}
                    testID="log-bp"
                    style={{ minHeight: 32, justifyContent: 'center' }}
                  >
                    <T variant="small" color={colors.primary}>
                      Log a cuff reading
                    </T>
                  </Pressable>
                </View>
                {bp?.value != null && bp.value_secondary != null ? (
                  <>
                    <T variant="label" style={{ textAlign: 'right' }}>
                      {`${bp.value}/${bp.value_secondary} mmHg`}
                    </T>
                    <View style={{ width: 90, alignItems: 'flex-end' }}>
                      <StatusPill
                        label={
                          bp.source === 'cuff'
                            ? 'Your cuff'
                            : bp.source_detail
                              ? 'Your device'
                              : 'Estimate'
                        }
                        tone="muted"
                      />
                    </View>
                  </>
                ) : (
                  <T variant="small" color={colors.muted}>
                    No readings yet
                  </T>
                )}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
                testID="spo2-summary"
              >
                <View style={{ flex: 1 }}>
                  <T variant="body">SpO₂</T>
                  {spo2 ? (
                    <T variant="tiny" color={colors.muted} testID="spo2-source">
                      {spo2.source_detail
                        ? sourceLabel(spo2.source_detail)
                        : 'Experimental face-scan estimate'}
                    </T>
                  ) : null}
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push(syncOn ? '/health-readings' : '/settings')}
                    testID="spo2-sync-link"
                    style={{ minHeight: 32, justifyContent: 'center' }}
                  >
                    <T variant="small" color={colors.primary}>
                      {syncOn ? 'See synced readings' : 'Sync from your health app'}
                    </T>
                  </Pressable>
                </View>
                {spo2 ? (
                  <>
                    <T variant="label" style={{ textAlign: 'right' }}>
                      {`${spo2.value}%`}
                    </T>
                    <View style={{ width: 90, alignItems: 'flex-end' }}>
                      {spo2Camera ? (
                        <StatusPill label="Experimental" tone="warning" />
                      ) : (
                        <StatusPill label="Your device" tone="muted" />
                      )}
                    </View>
                  </>
                ) : (
                  <T variant="small" color={colors.muted}>
                    No readings yet
                  </T>
                )}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
