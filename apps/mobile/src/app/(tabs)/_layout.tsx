import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';
import { BottomNav } from '../../components/BottomNav';
import { Loading } from '../../components/ui';
import { useSession } from '../../state/session';

export default function TabsLayout() {
  const { status, me } = useSession();
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
