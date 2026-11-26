import { profileSchema } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../api/client';
import {
  BackHeader,
  Banner,
  Field,
  PrimaryButton,
  ProgressSteps,
  Screen,
  Segmented,
  T,
} from '../../components/ui';
import { useFlow } from '../../state/flow';
import { useSession } from '../../state/session';
import { colors, space } from '../../theme/tokens';

/** PDF page 3 — About you (Step 1 of 2). */
export default function About() {
  const { onboarding, setOnboarding } = useFlow();
  const { me, refreshMe } = useSession();
  const p = onboarding.profile;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof p>) =>
    setOnboarding((d) => ({ ...d, profile: { ...d.profile, ...patch } }));

  const parsed = profileSchema.safeParse({
    birth_year: Number(p.birth_year),
    sex_at_birth: p.sex_at_birth,
    height_cm: Number(p.height_cm.replace(',', '.')),
    weight_kg: Number(p.weight_kg.replace(',', '.')),
  });
  const fieldError = (k: string, raw: string) =>
    raw && !parsed.success
      ? (parsed.error.issues.find((i) => i.path[0] === k)?.message ?? null)
      : null;

  const next = async () => {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveProfile(parsed.data);
      await refreshMe();
      router.push('/onboarding/rhythm');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-about"
      footer={
        <PrimaryButton
          label="Continue"
          onPress={next}
          disabled={!parsed.success}
          loading={busy}
          testID="continue"
        />
      }
    >
      <BackHeader title="Step 1 of 2" onBack={me ? undefined : () => router.back()} />
      <ProgressSteps steps={2} current={0} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        About you
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[6] }}>
        Used to set your starting reference ranges until your own baseline is ready.
      </T>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Field
        label="Year of birth"
        placeholder="e.g. 1985"
        keyboardType="number-pad"
        maxLength={4}
        value={p.birth_year}
        onChangeText={(v) => set({ birth_year: v.replace(/\D/g, '') })}
        error={p.birth_year.length === 4 ? fieldError('birth_year', p.birth_year) : null}
        testID="birth-year"
      />
      <T variant="label" style={{ marginBottom: space[2], fontSize: 14 }}>
        Sex at birth
      </T>
      <Segmented
        label="Sex at birth"
        value={p.sex_at_birth}
        onChange={(v) => set({ sex_at_birth: v })}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
        ]}
        testID="sex"
      />
      <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[5] }}>
        <Field
          label="Height"
          placeholder="175"
          suffix="cm"
          keyboardType="decimal-pad"
          value={p.height_cm}
          onChangeText={(v) => set({ height_cm: v })}
          error={fieldError('height_cm', p.height_cm)}
          testID="height"
        />
        <Field
          label="Weight"
          placeholder="70"
          suffix="kg"
          keyboardType="decimal-pad"
          value={p.weight_kg}
          onChangeText={(v) => set({ weight_kg: v })}
          error={fieldError('weight_kg', p.weight_kg)}
          testID="weight"
        />
      </View>
      <T variant="small" color={colors.muted}>
        You can change these anytime in your profile.
      </T>
    </Screen>
  );
}
