import { router } from 'expo-router';
import { View } from 'react-native';
import { BackHeader, Banner, Screen, T } from '../components/ui';
import { colors, space } from '../theme/tokens';

const SECTIONS: [string, string][] = [
  [
    'What we collect',
    'Your email, the profile you enter (year of birth, sex at birth, height, weight), your scan schedule, your check-in answers, and the readings derived from each scan with their quality information.',
  ],
  [
    'What we never collect',
    'Camera video and images never leave your phone and are never stored. The app reads average skin colour from your forehead and cheeks frame by frame, then discards each frame.',
  ],
  [
    'Why',
    'To show your readings, learn your personal baseline over 14 days, and show trends and insights based only on your own records.',
  ],
  [
    'Optional health app sync',
    'Off unless you turn it on in Settings. When on, EdgeVitals reads only oxygen saturation (SpO₂) and blood pressure from Health Connect (Android) or Apple Health (iPhone), never writes to them, and stores a copy labelled with the app and device that recorded it. Turning it off stops reading and, on Android, removes our access; you can delete the copies at any time. These readings never feed your baseline or scores.',
  ],
  [
    'Optional anonymised data',
    'Off unless you turn it on. You can withdraw it at any time in Settings without affecting the app.',
  ],
  [
    'Your controls',
    'Edit your profile, change consents, export all your data as a file, or delete your account and all readings from Settings. Deletion is immediate; encrypted backups expire on our backup schedule.',
  ],
  [
    'Not a medical device',
    'EdgeVitals provides wellness information only. Camera estimates are not clinically validated and must not be used for diagnosis or treatment.',
  ],
];

export default function Privacy() {
  return (
    <Screen testID="screen-privacy">
      <BackHeader title="Privacy policy" onBack={() => router.back()} />
      <Banner
        tone="info"
        title="Draft policy"
        body="This summary must be reviewed by qualified privacy counsel before launch."
      />
      {SECTIONS.map(([h, b]) => (
        <View key={h} style={{ marginBottom: space[5] }}>
          <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[1] }}>
            {h}
          </T>
          <T variant="body" color={colors.textSecondary}>
            {b}
          </T>
        </View>
      ))}
    </Screen>
  );
}
