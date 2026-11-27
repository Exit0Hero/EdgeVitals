import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_URL } from '../api/client';
import { ConfigProblem } from '../components/AppErrorBoundary';
import { CrashNotice } from '../components/CrashNotice';
import { installCrashRecorder } from '../lib/crashRecorder';
import { releaseConfigProblem } from '../lib/releaseConfig';
import { FlowProvider } from '../state/flow';
import { SessionProvider } from '../state/session';

// Record fatal errors before the first render, so a crash on any screen is kept.
installCrashRecorder();

// A render error on any screen shows a recovery screen instead of a blank app.
export { AppErrorBoundary as ErrorBoundary } from '../components/AppErrorBoundary';

const configProblem = releaseConfigProblem({
  apiUrl: API_URL,
  isDev: __DEV__,
  platform: Platform.OS,
});

export default function RootLayout() {
  if (configProblem) {
    return (
      <SafeAreaProvider>
        <ConfigProblem problem={configProblem} />
      </SafeAreaProvider>
    );
  }
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
            <Stack.Screen
              name="assessment/finger-scan"
              options={{ gestureEnabled: false, animation: 'fade' }}
            />
          </Stack>
          <CrashNotice />
        </FlowProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
