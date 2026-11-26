import { Redirect, router, Slot } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { BottomNav } from '../../components/BottomNav';
import { Loading } from '../../components/ui';
import { useReminderTap } from '../../lib/reminders';
import { useSession } from '../../state/session';

export default function TabsLayout() {
  const { status, me } = useSession();
  // Tapping a reminder opens that scan's check-in.
  const tap = useReminderTap();
  const handled = useRef<string | null>(null);
  const ready = status === 'signedIn' && !!me?.onboarding_complete;
  useEffect(() => {
    if (!ready || !tap || handled.current === tap.id) return;
    handled.current = tap.id;
    router.push({ pathname: '/assessment/check-in', params: { kind: tap.kind } });
  }, [ready, tap]);
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut' || !me?.onboarding_complete) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      <BottomNav />
    </View>
  );
}
