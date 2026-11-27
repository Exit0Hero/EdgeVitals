import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CrashNotice } from '../components/CrashNotice';
import { installCrashRecorder } from '../lib/crashRecorder';
import { FlowProvider } from '../state/flow';
import { SessionProvider } from '../state/session';

// Record fatal errors before the first render, so a crash on any screen is kept.
installCrashRecorder();

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
          <CrashNotice />
        </FlowProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
