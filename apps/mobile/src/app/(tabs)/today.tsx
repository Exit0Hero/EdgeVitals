import { useFocusEffect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError, type Dashboard } from '../../api/client';
import { Ring, LineChart } from '../../components/charts';
import { Icon } from '../../components/Icon';
import { Card, ErrorState, Loading, PrimaryButton, StatusPill, T } from '../../components/ui';
import { VitalChips, VitalTiles } from '../../components/vitals';
import { greeting, longDate, relativeWhen } from '../../lib/format';
import { useSession } from '../../state/session';
import { useReminderSync } from '../../state/useReminderSync';
import { colors, radius, space } from '../../theme/tokens';

export function useDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.dashboard());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your dashboard');
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { data, error, loading, reload: load };
}

const RECOVERY_COPY: Record<string, [string, string]> = {
  Good: ["You're well recovered", 'A good day to move a little more.'],
  Fair: ["You're fairly recovered", 'Keep today steady and listen to your body.'],
  Low: ['Recovery is lower than usual', 'Consider an easier day and an early night.'],
};
const ENERGY_COPY: Record<string, string> = {
  Charged: 'Fully charged',
  Steady: 'Steady energy',
  Low: 'Running low',
};

/** PDF pages 5 (baseline) and 10 (mature dashboard). */
export default function Today() {
  const { data, error, loading, reload } = useDashboard();
  const { me } = useSession();
  useReminderSync(data?.today);
  const now = new Date();

  if (!data && loading) return <Loading label="Loading today" />;
  if (!data)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <ErrorState message={error ?? 'Something went wrong'} onRetry={reload} />
      </SafeAreaView>
    );

  const mature = data.baseline.ready;
  const nextKind = !data.today.morning ? 'morning' : !data.today.evening ? 'evening' : null;
  const tz = me?.schedule?.timezone;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.hero }}
      edges={['top']}
      testID="screen-today"
    >
      <ScrollView
        style={{ backgroundColor: colors.white }}
        contentContainerStyle={{ paddingBottom: space[8] }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      >
        {/* Hero */}
        <View
          style={{
            backgroundColor: colors.hero,
            paddingHorizontal: space[5],
            paddingTop: space[3],
            paddingBottom: space[5],
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <T variant="small" color={colors.textSecondary}>
                {longDate(now, tz)}
              </T>
              <T variant="title" accessibilityRole="header">
                {greeting(now)}
              </T>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              {data.streak > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: colors.white,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                  }}
                  testID="streak"
                >
                  <Icon name="flame" size={15} />
                  <T variant="small" style={{ fontWeight: '700' }}>
                    {mature
                      ? `${data.streak}-day streak`
                      : `${data.streak} ${data.streak === 1 ? 'day' : 'days'}`}
                  </T>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                onPress={() => router.push('/settings')}
                hitSlop={10}
                testID="open-settings"
              >
                <Icon name="settings" color={colors.textSecondary} size={20} />
              </Pressable>
            </View>
          </View>

          {mature ? (
            <RecoveryHero data={data} />
          ) : (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[4],
                marginTop: space[5],
              }}
              testID="baseline-progress"
            >
              <Ring
                progress={data.baseline.day / data.baseline.totalDays}
                label={`${Math.min(data.baseline.day, 14)}/14`}
                accessibilityLabel={`Baseline day ${data.baseline.day} of 14`}
              />
              <View style={{ flex: 1 }}>
                <T variant="heading">
                  {data.baseline.periodComplete ? 'Almost there' : "We're getting to know you"}
                </T>
                <T variant="small" color={colors.textSecondary}>
                  {data.baseline.day === 0
                    ? 'Complete your first scan to start your 14-day baseline.'
                    : data.baseline.periodComplete
                      ? 'We need a few more clear morning readings before your baseline is ready.'
                      : `${data.baseline.daysRemaining} more ${data.baseline.daysRemaining === 1 ? 'day' : 'days'} and EdgeVitals will know what normal looks like for you.`}
                </T>
              </View>
            </View>
          )}

          <AssessmentAction data={data} nextKind={nextKind} mature={mature} />
        </View>

        <View style={{ paddingHorizontal: space[5], paddingTop: space[5], gap: space[5] }}>
          {mature ? <MatureSections data={data} /> : <BaselineSections data={data} />}
          <T variant="tiny" color={colors.muted} style={{ textAlign: 'center' }}>
            Wellness information only, not for diagnosis. Camera estimates are not clinically
            validated.
          </T>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AssessmentAction({
  data,
  nextKind,
  mature,
}: {
  data: Dashboard;
  nextKind: 'morning' | 'evening' | null;
  mature: boolean;
}) {
  const go = (kind: 'morning' | 'evening') =>
    router.push({ pathname: '/assessment/check-in', params: { kind } });
  if (!nextKind)
    return (
      <Card
        tone="white"
        style={{ marginTop: space[5], flexDirection: 'row', alignItems: 'center', gap: space[3] }}
        testID="all-done"
      >
        <Icon name="check" color={colors.success} />
        <T variant="label" style={{ flex: 1 }}>
          Both assessments done today
        </T>
      </Card>
    );
  if (mature && data.today.morning)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run evening assessment. Morning done"
        onPress={() => go('evening')}
        testID="run-evening"
        style={({ pressed }) => ({
          marginTop: space[5],
          backgroundColor: pressed ? colors.primaryPressed : colors.primary,
          borderRadius: radius.control,
          padding: space[4],
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
        })}
      >
        <Icon name="pulse" color={colors.white} />
        <T variant="label" color={colors.white} style={{ flex: 1, fontSize: 16 }}>
          Run evening assessment
        </T>
        <View style={{ alignItems: 'center' }}>
          <T variant="small" color={colors.white}>
            Morning done
          </T>
          <Icon name="check" color={colors.white} size={16} />
        </View>
      </Pressable>
    );
  return (
    <PrimaryButton
      label={nextKind === 'morning' ? 'Run morning assessment' : 'Run evening assessment'}
      icon="pulse"
      onPress={() => go(nextKind)}
      style={{ marginTop: space[5] }}
      testID={`run-${nextKind}`}
    />
  );
}

function RecoveryHero({ data }: { data: Dashboard }) {
  const r = data.scores.recovery;
  const copy = r ? RECOVERY_COPY[r.label] : null;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[4], marginTop: space[5] }}
      testID="recovery-hero"
    >
      <Ring
        size={104}
        stroke={8}
        progress={r ? r.value / 100 : 0}
        label={r ? String(r.value) : '—'}
        labelSize={30}
        accessibilityLabel={
          r ? `Recovery ${r.value}, ${r.label}` : 'Recovery not available yet today'
        }
      />
      <View style={{ flex: 1 }}>
        <T variant="small" color={colors.textSecondary}>
          Recovery
        </T>
        <T variant="heading" style={{ fontSize: 21, lineHeight: 26 }}>
          {copy ? copy[0] : 'Recovery appears after your morning scan'}
        </T>
        <T variant="small" color={colors.textSecondary} style={{ marginTop: 4 }}>
          {copy ? copy[1] : (data.scores.withheld.recovery ?? '')}
        </T>
      </View>
    </View>
  );
}

function ScoreCard({
  title,
  score,
  usual,
  note,
  invert,
}: {
  title: string;
  score: { value: number; label: string } | null;
  usual: number | null;
  note: string | null;
  invert?: boolean;
}) {
  const delta = score && usual !== null ? score.value - usual : null;
  return (
    <Card style={{ flex: 1, padding: space[3] }} testID={`score-${title.toLowerCase()}`}>
      <T variant="tiny" color={colors.muted} style={{ fontSize: 12 }}>
        {title}
      </T>
      <T variant="metric" style={{ marginTop: 2 }}>
        {score ? score.value : '—'}
      </T>
      <T variant="small" color={colors.primary} style={{ fontWeight: '700' }}>
        {score ? score.label : 'Not yet'}
      </T>
      <T variant="tiny" color={colors.muted} style={{ marginTop: 2 }}>
        {delta !== null && delta !== 0
          ? `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} vs usual`
          : delta === 0
            ? 'Same as usual'
            : (note ?? '')}
      </T>
      {invert ? null : null}
    </Card>
  );
}

function MatureSections({ data }: { data: Dashboard }) {
  const s = data.scores;
  const rec = data.progress.recovery;
  const change =
    rec && rec.firstHalfAverage && rec.secondHalfAverage
      ? Math.round(((rec.secondHalfAverage - rec.firstHalfAverage) / rec.firstHalfAverage) * 100)
      : null;
  const rhr = data.progress.resting_heart_rate;
  const hrv = data.progress.hrv;
  return (
    <>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <ScoreCard
          title="Recovery"
          score={s.recovery}
          usual={data.score_usual.recovery}
          note={s.withheld.recovery ?? null}
        />
        <ScoreCard
          title="Stress"
          score={s.stress}
          usual={data.score_usual.stress}
          note={s.withheld.stress ?? null}
        />
        <ScoreCard
          title="Energy"
          score={s.energy}
          usual={null}
          note={s.energy ? (ENERGY_COPY[s.energy.label] ?? null) : (s.withheld.energy ?? null)}
        />
      </View>

      <View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: space[3],
          }}
        >
          <T variant="heading" accessibilityRole="header">
            Your progress
          </T>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/trends')} hitSlop={8}>
            <T variant="body" color={colors.primary}>
              All trends
            </T>
          </Pressable>
        </View>
        <Card>
          <T variant="small" color={colors.muted}>
            Recovery · last 4 weeks
          </T>
          <T variant="heading" style={{ marginBottom: space[3] }}>
            {change === null
              ? 'Building your trend'
              : change === 0
                ? 'Holding steady'
                : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% since you started`}
          </T>
          {rec ? (
            <LineChart
              points={rec.points.slice(-28)}
              summary={`Recovery over the last 4 weeks, ${rec.sampleCount} days with a score`}
            />
          ) : null}
        </Card>
        <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[3] }}>
          <Card style={{ flex: 1 }}>
            <T variant="small" color={colors.muted}>
              Resting heart rate
            </T>
            <T variant="heading">{rhr ? `${rhr.first} → ${rhr.recent} bpm` : '—'}</T>
            {rhr && rhr.recent !== rhr.first ? (
              <T variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
                {Math.abs(rhr.recent - rhr.first)} bpm {rhr.recent < rhr.first ? 'lower' : 'higher'}
              </T>
            ) : null}
          </Card>
          <Card style={{ flex: 1 }}>
            <T variant="small" color={colors.muted}>
              HRV
            </T>
            <T variant="heading">{hrv ? `${hrv.first} → ${hrv.recent} ms` : '—'}</T>
            {hrv && hrv.first > 0 && hrv.recent !== hrv.first ? (
              <T variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
                {hrv.recent > hrv.first ? '+' : ''}
                {Math.round(((hrv.recent - hrv.first) / hrv.first) * 100)}%
              </T>
            ) : null}
          </Card>
        </View>
      </View>

      {data.morning_vitals ? (
        <View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: space[3],
            }}
          >
            <T variant="heading" accessibilityRole="header">
              This morning's vitals
            </T>
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                router.push({
                  pathname: '/assessment/results',
                  params: { id: data.morning_vitals!.assessment_id },
                })
              }
              hitSlop={8}
            >
              <T variant="body" color={colors.primary}>
                Details
              </T>
            </Pressable>
          </View>
          <VitalChips vitals={data.morning_vitals.metrics} />
        </View>
      ) : null}

      {data.insight ? (
        <View>
          <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[3] }}>
            What's working for you
          </T>
          <Card tone="soft" style={{ flexDirection: 'row', gap: space[3] }} testID="insight">
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: colors.white,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="shield" />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="label">{data.insight.title}</T>
              <T variant="small" color={colors.textSecondary}>
                {data.insight.body}
              </T>
            </View>
          </Card>
        </View>
      ) : null}

      <ReportCard data={data} />
    </>
  );
}

function ReportCard({ data }: { data: Dashboard }) {
  const r = data.report;
  const progress = Math.min(1, Math.min(r.day / 30, r.assessmentDays / r.assessmentDaysNeeded));
  return (
    <Card testID="report-card">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="label">Your 30-day report</T>
        <T variant="small" color={colors.muted}>
          {r.unlocked ? 'Ready' : `${r.daysToGo} ${r.daysToGo === 1 ? 'day' : 'days'} to go`}
        </T>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        style={{
          height: 8,
          backgroundColor: colors.surface,
          borderRadius: 4,
          marginVertical: space[3],
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: 8,
            backgroundColor: colors.primary,
            borderRadius: 4,
          }}
        />
      </View>
      <T variant="small" color={colors.textSecondary}>
        {r.unlocked
          ? 'Your first monthly review is ready.'
          : `Keep your streak going to unlock your first monthly review (${r.assessmentDays} of ${r.assessmentDaysNeeded} days with a scan).`}
      </T>
    </Card>
  );
}

function BaselineSections({ data }: { data: Dashboard }) {
  const last = data.last_assessment;
  return (
    <>
      <View>
        <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[3] }}>
          Unlocking on day 14
        </T>
        {[
          ['Recovery, Stress and Energy scores', 'Your daily scores, measured against you'],
          ['Personal trends', 'See how your body changes week by week'],
        ].map(([title, sub]) => (
          <Card
            key={title}
            tone="surface"
            style={{
              flexDirection: 'row',
              gap: space[3],
              alignItems: 'center',
              marginBottom: space[2],
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: colors.white,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="lock" size={17} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="label">{title}</T>
              <T variant="small" color={colors.muted}>
                {sub}
              </T>
            </View>
          </Card>
        ))}
      </View>
      <View>
        {last ? (
          <>
            <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[3] }}>
              Last assessment · {relativeWhen(last.started_at)}
            </T>
            <VitalTiles vitals={last.metrics} testID="last-assessment" />
            <StatusPill label="Estimates · not clinically validated" tone="muted" />
          </>
        ) : (
          <Card tone="surface" testID="empty-state">
            <T variant="label">No assessments yet</T>
            <T variant="small" color={colors.muted}>
              Your readings will appear here after your first scan. Each scan takes about a minute.
            </T>
          </Card>
        )}
      </View>
    </>
  );
}
