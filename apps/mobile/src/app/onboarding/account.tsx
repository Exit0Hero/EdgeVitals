import { CONSENT_POLICY_VERSION, passwordSchema } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { BackHeader, Banner, Field, PrimaryButton, Screen, T } from '../../components/ui';
import { useFlow } from '../../state/flow';
import { useSession } from '../../state/session';
import { colors, space } from '../../theme/tokens';

/**
 * Account creation. Not drawn in the 12-page POC, but FR-001 requires an
 * account; placed after consent so nothing is stored before agreement
 * (see docs/design-deviations.md).
 */
export default function Account() {
  const { onboarding } = useFlow();
  const { register, refreshMe } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pw = password ? passwordSchema.safeParse(password) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password);
      const c = onboarding.consents;
      await api.grantConsent('processing', c.processing, CONSENT_POLICY_VERSION);
      await api.grantConsent(
        'wellness_acknowledgement',
        c.wellness_acknowledgement,
        CONSENT_POLICY_VERSION,
      );
      if (c.anonymous_improvement)
        await api.grantConsent('anonymous_improvement', true, CONSENT_POLICY_VERSION);
      await refreshMe();
      router.replace('/onboarding/about');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-account"
      footer={
        <PrimaryButton
          label="Create account"
          onPress={submit}
          loading={busy}
          disabled={!email.includes('@') || !pw?.success}
          testID="create-account"
        />
      }
    >
      <BackHeader onBack={() => router.back()} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        Create your account
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[6] }}>
        So your baseline and history are kept safe and can be exported or deleted.
      </T>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        testID="email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        testID="password"
        error={pw && !pw.success ? pw.error.issues[0]?.message : null}
      />
      <T variant="small" color={colors.muted}>
        At least 10 characters, with letters and numbers.
      </T>
    </Screen>
  );
}
