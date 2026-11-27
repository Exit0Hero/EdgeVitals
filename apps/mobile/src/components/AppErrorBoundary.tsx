import { router } from 'expo-router';
import { Platform, Share, View } from 'react-native';
import { colors, space } from '../theme/tokens';
import { Icon } from './Icon';
import { PrimaryButton, Screen, T, TextButton } from './ui';

/**
 * Shown when a screen throws while rendering, instead of a blank screen or
 * the app closing. Only the error text is shared, and only if the person
 * chooses to; no readings, check-ins or camera data are included.
 */
export function AppErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const details = [
    `EdgeVitals screen error (${Platform.OS} ${String(Platform.Version)})`,
    `Time: ${new Date().toISOString()}`,
    `Message: ${error.name}: ${error.message}`.slice(0, 2000),
    error.stack ? `Stack:\n${error.stack.slice(0, 6000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Screen testID="screen-error">
      <View
        style={{ alignItems: 'center', gap: space[3], paddingTop: space[8] }}
        accessibilityRole="alert"
      >
        <Icon name="alert" color={colors.danger} size={32} />
        <T variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          Something went wrong
        </T>
        <T variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
          This screen hit an unexpected error. Your saved data is safe. Try again, or go back to
          Today.
        </T>
        <PrimaryButton
          label="Try again"
          onPress={() => void retry()}
          style={{ alignSelf: 'stretch' }}
        />
        <TextButton label="Go to Today" onPress={() => router.replace('/')} />
        {Platform.OS !== 'web' ? (
          <TextButton
            label="Share error details"
            onPress={() => void Share.share({ message: details }).catch(() => {})}
          />
        ) : null}
      </View>
    </Screen>
  );
}

/** Release build with an unusable API address: say so instead of failing every request. */
export function ConfigProblem({ problem }: { problem: string }) {
  return (
    <Screen testID="screen-config-problem">
      <View
        style={{ alignItems: 'center', gap: space[3], paddingTop: space[8] }}
        accessibilityRole="alert"
      >
        <Icon name="alert" color={colors.danger} size={32} />
        <T variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          This build can't connect
        </T>
        <T variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
          {problem} Rebuild the app with the real API address (EXPO_PUBLIC_API_URL).
        </T>
      </View>
    </Screen>
  );
}
