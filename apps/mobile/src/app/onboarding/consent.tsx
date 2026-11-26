import { CONSENT_POLICY_VERSION } from '@edgevitals/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { api, ApiError } from '../../api/client';
import { BackHeader, Banner, Checkbox, PrimaryButton, Screen, T } from '../../components/ui';
import { useFlow } from '../../state/flow';
import { useSession } from '../../state/session';
import { colors, space } from '../../theme/tokens';

/** PDF page 2 — Your data, your control. Required consents gate continuation; optional is separate and off by default. */
export default function Consent() {
  const { onboarding, setOnboarding } = useFlow();
  const { status, refreshMe } = useSession();
  const [region, setRegion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = onboarding.consents;

  useEffect(() => {
    api
      .config()
      .then((cfg) => setRegion(cfg.hosting_region))
      .catch(() => undefined);
  }, []);

  const toggle = (k: keyof typeof c) =>
    setOnboarding((d) => ({ ...d, consents: { ...d.consents, [k]: !d.consents[k] } }));

  const canContinue = c.processing && c.wellness_acknowledgement;

  const next = async () => {
    if (status !== 'signedIn') return router.push('/onboarding/account');
    // Resuming onboarding while signed in: record consent now.
    setBusy(true);
    setError(null);
    try {
      await api.grantConsent('processing', true, CONSENT_POLICY_VERSION);
      await api.grantConsent('wellness_acknowledgement', true, CONSENT_POLICY_VERSION);
      if (c.anonymous_improvement)
        await api.grantConsent('anonymous_improvement', true, CONSENT_POLICY_VERSION);
      await refreshMe();
      router.push('/onboarding/about');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your choices');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="screen-consent"
      footer={
        <PrimaryButton
          label="Agree and continue"
          onPress={next}
          disabled={!canContinue}
          loading={busy}
          testID="agree-continue"
        />
      }
    >
      <BackHeader
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[3] }}>
        Your data, your control
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[5] }}>
        Your readings are stored securely in {region ?? '[hosting region not configured]'}. You can
        export or delete them anytime.
      </T>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Checkbox
        checked={c.processing}
        onToggle={() => toggle('processing')}
        testID="consent-processing"
        accessibilityLabel="I agree to EdgeVitals processing my readings to provide wellness insights (required)"
      >
        <T variant="body">
          I agree to EdgeVitals processing my readings to provide wellness insights{' '}
          <T variant="body" color={colors.muted}>
            (required)
          </T>
        </T>
      </Checkbox>
      <Checkbox
        checked={c.wellness_acknowledgement}
        onToggle={() => toggle('wellness_acknowledgement')}
        testID="consent-wellness"
        accessibilityLabel="I understand EdgeVitals is a wellness app, not a medical device (required)"
      >
        <T variant="body">
          I understand EdgeVitals is a wellness app, not a medical device{' '}
          <T variant="body" color={colors.muted}>
            (required)
          </T>
        </T>
      </Checkbox>
      <Checkbox
        checked={c.anonymous_improvement}
        onToggle={() => toggle('anonymous_improvement')}
        testID="consent-optional"
        accessibilityLabel="Help improve EdgeVitals with anonymised data (optional)"
      >
        <T variant="body">
          Help improve EdgeVitals with anonymised data{' '}
          <T variant="body" color={colors.muted}>
            (optional)
          </T>
        </T>
      </Checkbox>
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push('/privacy')}
        style={{ marginTop: space[3], minHeight: 44, justifyContent: 'center' }}
        testID="privacy-link"
      >
        <T variant="body" color={colors.primary} style={{ textDecorationLine: 'underline' }}>
          Read the privacy policy
        </T>
      </Pressable>
    </Screen>
  );
}
