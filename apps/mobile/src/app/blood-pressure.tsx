import { cuffReadingSchema } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError, type CuffReading } from '../api/client';
import {
  BackHeader,
  Banner,
  Card,
  ErrorState,
  Field,
  Loading,
  PrimaryButton,
  Screen,
  T,
} from '../components/ui';
import { colors, space } from '../theme/tokens';

const toInt = (s: string) => (/^\d{2,3}$/.test(s.trim()) ? Number(s.trim()) : NaN);

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Log blood pressure from the user's own cuff. Self-reported; never a camera reading. */
export default function BloodPressure() {
  const [items, setItems] = useState<CuffReading[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .cuffReadings()
      .then((r) => setItems(r.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load readings'));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    setSaved(false);
    const candidate = {
      systolic: toInt(sys),
      diastolic: toInt(dia),
      pulse_bpm: pulse.trim() ? toInt(pulse) : null,
      measured_at: new Date().toISOString(),
    };
    const parsed = cuffReadingSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(
        Number.isNaN(candidate.systolic) || Number.isNaN(candidate.diastolic)
          ? 'Enter both numbers from your cuff, for example 120 and 80.'
          : (parsed.error.issues[0]?.message ?? 'Check the numbers'),
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await api.addCuffReading({
        ...parsed.data,
        pulse_bpm: parsed.data.pulse_bpm ?? null,
      });
      setItems((xs) => [r, ...(xs ?? [])]);
      setSys('');
      setDia('');
      setPulse('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the reading');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteCuffReading(id);
      setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the reading');
    }
  };

  return (
    <Screen testID="screen-blood-pressure">
      <BackHeader title="Blood pressure" onBack={() => router.back()} />
      <T variant="body" color={colors.textSecondary} style={{ marginBottom: space[4] }}>
        Enter the numbers from your own blood-pressure cuff. EdgeVitals can't measure blood pressure
        with the camera, so these readings are labelled "From your cuff".
      </T>
      <Card tone="surface" style={{ marginBottom: space[5] }}>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <Field
            label="Systolic (top)"
            suffix="mmHg"
            keyboardType="number-pad"
            value={sys}
            onChangeText={setSys}
            maxLength={3}
            testID="bp-systolic"
          />
          <Field
            label="Diastolic (bottom)"
            suffix="mmHg"
            keyboardType="number-pad"
            value={dia}
            onChangeText={setDia}
            maxLength={3}
            testID="bp-diastolic"
          />
        </View>
        <Field
          label="Pulse (optional)"
          suffix="bpm"
          keyboardType="number-pad"
          value={pulse}
          onChangeText={setPulse}
          maxLength={3}
          testID="bp-pulse"
        />
        {error ? <Banner tone="danger" title="Not saved" body={error} /> : null}
        {saved ? <Banner tone="info" title="Saved" body="Your reading was added." /> : null}
        <PrimaryButton label="Save reading" onPress={save} loading={busy} testID="bp-save" />
      </Card>

      <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        Recent readings
      </T>
      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : items === null ? (
        <Loading label="Loading readings" />
      ) : items.length === 0 ? (
        <T variant="small" color={colors.muted}>
          No readings yet.
        </T>
      ) : (
        items.map((r) => (
          <View
            key={r.id}
            testID="bp-row"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <T variant="label">{`${r.systolic}/${r.diastolic} mmHg`}</T>
              <T variant="small" color={colors.muted}>
                {`${when(r.measured_at)} · From your cuff${r.pulse_bpm ? ` · ${r.pulse_bpm} bpm` : ''}`}
              </T>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete reading ${r.systolic} over ${r.diastolic}`}
              onPress={() => remove(r.id)}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] }}
            >
              <T variant="body" color={colors.danger}>
                Delete
              </T>
            </Pressable>
          </View>
        ))
      )}
      <T variant="small" color={colors.muted} style={{ marginTop: space[5] }}>
        Wellness information only, not for diagnosis. If your readings are often high, talk to a
        health professional.
      </T>
    </Screen>
  );
}
