import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { AssessmentHeader } from '../../components/AssessmentHeader';
import {
  Banner,
  Loading,
  PrimaryButton,
  RatingScale,
  Screen,
  Segmented,
  T,
} from '../../components/ui';
import { deviceTimeZone, uuid } from '../../lib/id';
import { useFlow } from '../../state/flow';
import { useSession } from '../../state/session';
import { space } from '../../theme/tokens';

/** Scheduled slot for today in the user's local time, e.g. 07:15 → ISO with offset. */
function scheduledFor(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

/** PDF pages 6 (morning) and 11 (evening). Answers survive back navigation (FR-033). */
export default function CheckIn() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const { me } = useSession();
  const { assessment: a, setAssessment } = useFlow();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvedKind, setResolvedKind] = useState<'morning' | 'evening' | null>(
    params.kind === 'morning' || params.kind === 'evening' ? params.kind : null,
  );

  // Centre nav button: pick the next due assessment from today's state.
  useEffect(() => {
    if (resolvedKind) return;
    if (a && !a.result) return setResolvedKind(a.kind);
    api
      .dashboard()
      .then((d) => setResolvedKind(!d.today.morning ? 'morning' : 'evening'))
      .catch(() => setResolvedKind(new Date().getHours() < 15 ? 'morning' : 'evening'));
  }, [resolvedKind, a]);

  // Start a fresh draft once, when this screen opens. This screen stays mounted
  // under prepare/scan/results, so re-running this when the scan stores its
  // result would wipe that result (and the results screen's scan details).
  const draftChecked = useRef(false);
  useEffect(() => {
    if (!resolvedKind || !me?.schedule || draftChecked.current) return;
    draftChecked.current = true;
    if (a && a.kind === resolvedKind && !a.result) return;
    setAssessment(() => ({
      kind: resolvedKind,
      idempotencyKey: uuid(),
      scheduledFor: scheduledFor(
        resolvedKind === 'morning' ? me.schedule!.morning_time : me.schedule!.evening_time,
      ),
      assessmentId: null,
      sleep: null,
      energy: null,
      stress: null,
      alcohol: null,
      result: null,
    }));
  }, [resolvedKind, me, a, setAssessment]);

  if (!a || !resolvedKind || a.kind !== resolvedKind) return <Loading />;
  const set = (patch: Partial<typeof a>) => setAssessment((d) => (d ? { ...d, ...patch } : d));
  const morning = a.kind === 'morning';
  const complete = morning
    ? a.sleep !== null && a.energy !== null && a.alcohol !== null
    : a.stress !== null && a.energy !== null;

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = a.assessmentId;
      if (!id) {
        id = (
          await api.createAssessment(a.kind, a.scheduledFor, deviceTimeZone(), a.idempotencyKey)
        ).id;
        set({ assessmentId: id });
      }
      await api.checkIn(
        id,
        morning
          ? {
              kind: 'morning',
              sleep_quality: a.sleep,
              energy_rating: a.energy,
              alcohol_previous_evening: a.alcohol,
            }
          : { kind: 'evening', stress_rating: a.stress, energy_rating: a.energy },
      );
      router.push('/assessment/prepare');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'consent_required'
            ? 'Assessments are paused because required consent was withdrawn. You can review it in Settings.'
            : e.message
          : 'Could not save your check-in',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID={`screen-checkin-${a.kind}`}
      footer={
        <PrimaryButton
          label="Next: scan"
          onPress={next}
          disabled={!complete}
          loading={busy}
          testID="next-scan"
        />
      }
    >
      <AssessmentHeader
        kind={a.kind}
        step={0}
        onBack={() => (router.canGoBack() ? router.back() : router.dismissTo('/today'))}
      />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[5] }}>
        {morning ? 'How are you this morning?' : 'How was your day?'}
      </T>
      {error ? <Banner tone="danger" title={error} /> : null}
      {morning ? (
        <>
          <RatingScale
            label="How did you sleep?"
            low="Poorly"
            high="Very well"
            value={a.sleep}
            onChange={(v) => set({ sleep: v })}
            testID="sleep"
          />
          <RatingScale
            label="How is your energy?"
            low="Very low"
            high="Very high"
            value={a.energy}
            onChange={(v) => set({ energy: v })}
            testID="energy"
          />
          <T variant="heading" style={{ marginBottom: space[3] }}>
            Any alcohol yesterday evening?
          </T>
          <Segmented
            label="Any alcohol yesterday evening?"
            value={a.alcohol === null ? null : a.alcohol ? 'yes' : 'no'}
            onChange={(v) => set({ alcohol: v === 'yes' })}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
            testID="alcohol"
          />
        </>
      ) : (
        <>
          <RatingScale
            label="How stressed did you feel?"
            low="Calm"
            high="Very stressed"
            value={a.stress}
            onChange={(v) => set({ stress: v })}
            testID="stress"
          />
          <RatingScale
            label="How is your energy now?"
            low="Very low"
            high="Very high"
            value={a.energy}
            onChange={(v) => set({ energy: v })}
            testID="energy"
          />
        </>
      )}
    </Screen>
  );
}
