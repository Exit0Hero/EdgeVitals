import { router } from 'expo-router';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { TimeField } from '../../components/TimeField';
import {
  BackHeader,
  Banner,
  PrimaryButton,
  ProgressSteps,
  Screen,
  Segmented,
  T,
} from '../../components/ui';
import { deviceTimeZone } from '../../lib/id';
import { useFlow } from '../../state/flow';
import { useSession } from '../../state/session';
import { colors, space } from '../../theme/tokens';

/** PDF page 4 — Your daily rhythm (Step 2 of 2). "Yes" never asks for a medication name (FR-014). */
export default function Rhythm() {
  const { onboarding, setOnboarding } = useFlow();
  const { refreshMe } = useSession();
  const s = onboarding.schedule;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof s>) =>
    setOnboarding((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveSchedule({
        morning_time: s.morning_time,
        evening_time: s.evening_time,
        timezone: deviceTimeZone(),
        reminders_enabled: true,
        heart_rate_affecting_substance: s.heart_rate_affecting_substance,
      });
      await refreshMe();
      router.replace('/today');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your schedule');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-rhythm"
      footer={
        <PrimaryButton
          label="Start my baseline"
          onPress={start}
          loading={busy}
          testID="start-baseline"
        />
      }
    >
      <BackHeader title="Step 2 of 2" onBack={() => router.back()} />
      <ProgressSteps steps={2} current={1} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        Your daily rhythm
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[5] }}>
        Scanning at the same times each day keeps your baseline accurate. We'll remind you.
      </T>
      {error ? <Banner tone="danger" title={error} /> : null}
      <TimeField
        title="Morning scan"
        subtitle="Soon after waking, before coffee"
        value={s.morning_time}
        onChange={(v) => set({ morning_time: v })}
        testID="morning-time"
      />
      <TimeField
        title="Evening scan"
        subtitle="Before winding down for bed"
        value={s.evening_time}
        onChange={(v) => set({ evening_time: v })}
        testID="evening-time"
      />
      <T variant="label" style={{ marginTop: space[4], marginBottom: space[3] }}>
        Do you take anything that affects your heart rate?
      </T>
      <Segmented
        label="Do you take anything that affects your heart rate?"
        value={s.heart_rate_affecting_substance}
        onChange={(v) => set({ heart_rate_affecting_substance: v })}
        options={[
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
          { value: 'skip', label: 'Skip' },
        ]}
        testID="hr-substance"
      />
      <T variant="small" color={colors.muted} style={{ marginTop: space[3] }}>
        Optional. For example beta-blockers. Helps us read your heart data correctly.
      </T>
    </Screen>
  );
}
