import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError, type Assessment, type Dashboard } from '../../api/client';
import { AssessmentHeader } from '../../components/AssessmentHeader';
import { FingerPulseCard } from '../../components/FingerPulseCard';
import { ScanDetails } from '../../components/ScanDetails';
import { SyncedVitals } from '../../components/SyncedVitals';
import {
  Banner,
  Card,
  ErrorState,
  Loading,
  PrimaryButton,
  Screen,
  T,
  TextButton,
} from '../../components/ui';
import { VitalRows } from '../../components/vitals';
import { timeOfDay } from '../../lib/format';
import { uuid } from '../../lib/id';
import { useFlow } from '../../state/flow';
import { scanFor, traceFor } from '../../state/lastScan';
import { colors, space } from '../../theme/tokens';

const RETRY_TIPS = [
  'Sit facing a window or lamp so light falls evenly on your face.',
  'Rest your elbows on a table so the phone stays still.',
  'Keep your whole face inside the oval and avoid talking.',
];

const FINGER_RETRY_TIPS = [
  'Cover both the camera and the flash with the pad of your fingertip.',
  'Rest the finger lightly. Pressing hard squeezes the blood out and flattens the pulse.',
  'Rest your hand on a table and keep it still. Warm cold hands first.',
];

/** PDF page 9 — Results. Only values that passed their quality gates are shown (FR-051). */
export default function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setAssessment, assessment: draft } = useFlow();
  const [a, setA] = useState<Assessment | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [x, d] = await Promise.all([api.getAssessment(id!), api.dashboard()]);
      setA(x);
      setDash(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load results');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <Screen>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  if (!a || !dash) return <Loading label="Loading results" />;

  const relative = new Map(
    (dash.last_assessment?.assessment_id === a.id
      ? dash.last_assessment.metrics
      : dash.morning_vitals?.assessment_id === a.id
        ? dash.morning_vitals.metrics
        : []
    ).map((m) => [m.metric, m.relative]),
  );
  const vitals = a.measurements.map((m) => ({
    ...m,
    relative: a.demo ? undefined : (relative.get(m.metric) ?? 'no_baseline'),
  }));
  const validCount = a.measurements.filter((m) => m.status === 'valid').length;
  const sdkVitals = a.measurements.some((m) => m.method === 'licensed_sdk' && m.status === 'valid');
  const experimentalSpo2 = a.measurements.some(
    (m) => m.method === 'camera_experimental' && m.status === 'valid',
  );
  const failed = a.status === 'failed';
  const scanResult =
    scanFor(a.id) ?? (draft?.assessmentId === a.id ? (draft.result ?? null) : null);
  const fingerScan =
    scanResult?.scanType === 'finger' || a.measurements.some((m) => m.method === 'finger_ppg');
  const isToday = dash.today[a.kind]?.assessment_id === a.id;
  const scores = isToday && !a.demo ? dash.scores : null;
  const rec = scores?.recovery;
  const ci = a.check_in;
  const context = [
    timeOfDay(a.started_at, a.timezone),
    ci?.sleep_quality ? `Sleep ${ci.sleep_quality}/5` : null,
    ci?.stress_rating ? `Stress ${ci.stress_rating}/5` : null,
    ci ? `Energy ${ci.energy_rating}/5` : null,
    ci?.alcohol_previous_evening === true
      ? 'Alcohol'
      : ci?.alcohol_previous_evening === false
        ? 'No alcohol'
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const headline = a.demo
    ? 'Demo results'
    : failed
      ? "We couldn't get a reliable reading"
      : rec
        ? rec.label === 'Good'
          ? "You've recovered well"
          : rec.label === 'Fair'
            ? "You're fairly recovered"
            : 'Your recovery is lower today'
        : 'Scan saved';

  const retry = () => {
    if (draft)
      setAssessment(() => ({ ...draft, idempotencyKey: uuid(), assessmentId: null, result: null }));
    router.replace({ pathname: '/assessment/check-in', params: { kind: a.kind } });
  };

  return (
    <Screen
      testID="screen-results"
      footer={
        <>
          {failed ? <PrimaryButton label="Try again" onPress={retry} testID="retry" /> : null}
          {failed ? (
            <TextButton label="Done" onPress={() => router.dismissTo('/today')} testID="done" />
          ) : (
            <PrimaryButton
              label="Done"
              onPress={() => {
                setAssessment(() => null);
                router.dismissTo('/today');
              }}
              testID="done"
            />
          )}
        </>
      }
    >
      <AssessmentHeader kind={a.kind} step={2} onBack={() => router.dismissTo('/today')} />
      <T variant="title" accessibilityRole="header" testID="results-headline">
        {headline}
      </T>
      <T variant="small" color={colors.muted} style={{ marginBottom: space[5] }}>
        {context}
      </T>
      {a.demo ? (
        <Banner
          tone="info"
          title="Demo data"
          body="These values are simulated fixtures, not measurements. They are not saved to your baseline or trends."
          testID="demo-banner"
        />
      ) : null}

      {failed ? (
        <Card tone="surface" testID="failure-tips" style={{ marginBottom: space[5] }}>
          <T variant="label" style={{ marginBottom: space[2] }}>
            Nothing is wrong. The camera signal just wasn't clear enough this time.
          </T>
          {(fingerScan ? FINGER_RETRY_TIPS : RETRY_TIPS).map((t) => (
            <T key={t} variant="small" color={colors.textSecondary} style={{ marginBottom: 4 }}>
              • {t}
            </T>
          ))}
        </Card>
      ) : null}

      {!failed && !a.demo ? (
        <View style={{ flexDirection: 'row', gap: space[3], marginBottom: space[5] }}>
          {(['recovery', 'stress'] as const).map((k) => {
            const s = scores?.[k] ?? null;
            const desc =
              k === 'recovery'
                ? 'HRV and resting heart rate compared with your usual'
                : 'Heart rhythm and how you said you feel, compared with your usual';
            return (
              <Card key={k} style={{ flex: 1 }} testID={`result-${k}`}>
                <T variant="small" color={colors.muted}>
                  {k === 'recovery' ? 'Recovery' : 'Stress'}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <T variant="metricLarge">{s ? s.value : '—'}</T>
                  <T variant="label" color={colors.primary}>
                    {s?.label ?? ''}
                  </T>
                </View>
                {s ? (
                  <View
                    style={{
                      height: 4,
                      backgroundColor: colors.surface,
                      borderRadius: 2,
                      marginVertical: space[2],
                    }}
                  >
                    <View
                      style={{
                        width: `${s.value}%`,
                        height: 4,
                        backgroundColor: colors.primary,
                        borderRadius: 2,
                      }}
                    />
                  </View>
                ) : null}
                <T variant="tiny" color={colors.muted}>
                  {s
                    ? desc
                    : (scores?.withheld[k] ??
                      (dash.baseline.ready
                        ? 'Not available for this scan'
                        : 'Unlocks when your 14-day baseline is ready'))}
                </T>
              </Card>
            );
          })}
        </View>
      ) : null}

      <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[1] }}>
        Your vitals
      </T>
      {!dash.baseline.ready && !a.demo && validCount > 0 ? (
        <T variant="small" color={colors.muted} style={{ marginBottom: space[2] }}>
          Not enough personal history yet to compare. Day {dash.baseline.day} of 14.
        </T>
      ) : null}
      <VitalRows vitals={vitals} />
      {!a.demo && fingerScan && scanResult ? <FingerPulseCard result={scanResult} /> : null}
      {!a.demo ? <SyncedVitals /> : null}
      {!a.demo ? (
        <TextButton
          label="Log blood pressure from your cuff"
          onPress={() => router.push('/blood-pressure')}
          testID="results-log-bp"
        />
      ) : null}
      {/* On-device statistics for this scan (kept only in memory, never uploaded). */}
      {!a.demo && scanResult ? (
        <View style={{ marginTop: space[4] }}>
          <ScanDetails result={scanResult} trace={traceFor(a.id)} initiallyOpen={failed} />
        </View>
      ) : null}
      <T variant="small" color={colors.muted} style={{ marginTop: space[4] }}>
        Wellness information only, not for diagnosis. Heart rate, HRV and breathing are{' '}
        {fingerScan ? 'finger-scan' : 'camera'} estimates that have not been clinically validated.{' '}
        {sdkVitals
          ? 'SpO₂ and blood pressure are wellness estimates from a licensed camera SDK. EdgeVitals has not validated them, and they are not a substitute for a pulse oximeter or blood-pressure cuff.'
          : experimentalSpo2
            ? 'SpO₂ is an experimental estimate from a published research method that EdgeVitals has not validated. It can be off by several points and can miss low oxygen, so do not use it for health decisions. Blood pressure is not available from the camera.'
            : 'SpO₂ and blood pressure are not available from the camera on this device.'}{' '}
        If readings stay higher than usual, consider talking to a health professional.
      </T>
    </Screen>
  );
}
