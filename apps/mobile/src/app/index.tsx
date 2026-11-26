import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useSession } from '../state/session';

/** Routes a launch to the right place: welcome, unfinished onboarding, or Today. */
export default function Index() {
  const { status, me } = useSession();
  if (status === 'loading') return <Loading label="Starting EdgeVitals" />;
  if (status === 'signedOut' || !me) return <Redirect href="/welcome" />;
  if (!me.required_consents_granted) return <Redirect href="/onboarding/consent" />;
  if (!me.profile) return <Redirect href="/onboarding/about" />;
  if (!me.schedule) return <Redirect href="/onboarding/rhythm" />;
  return <Redirect href="/today" />;
}
