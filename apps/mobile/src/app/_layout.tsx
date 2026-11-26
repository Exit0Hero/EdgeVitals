import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FlowProvider } from '../state/flow';
import { SessionProvider } from '../state/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <FlowProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
            <Stack.Screen
              name="assessment/scan"
              options={{ gestureEnabled: false, animation: 'fade' }}
            />
          </Stack>
        </FlowProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
