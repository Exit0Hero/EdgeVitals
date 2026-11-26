import { router } from 'expo-router';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { BackHeader, Banner, Field, PrimaryButton, Screen, T } from '../components/ui';
import { useSession } from '../state/session';
import { colors, space } from '../theme/tokens';

/** Returning user: Welcome → Sign in → Today (functional spec §1). */
export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-sign-in"
      footer={
        <PrimaryButton
          label="Sign in"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
          testID="sign-in-submit"
        />
      }
    >
      <BackHeader onBack={() => router.back()} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[2] }}>
        Welcome back
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[6] }}>
        Sign in to see your baseline and trends.
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
        autoComplete="current-password"
        testID="password"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
