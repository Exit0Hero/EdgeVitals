import { router } from 'expo-router';
import { View } from 'react-native';
import { Icon, type IconName } from '../components/Icon';
import { PrimaryButton, Screen, T, TextButton } from '../components/ui';
import { colors, radius, space } from '../theme/tokens';

const POINTS: { icon: IconName; text: string }[] = [
  {
    icon: 'heart',
    text: 'Heart rate, pulse-rate variability (PRV), breathing, SpO₂ and blood pressure',
  },
  { icon: 'chart', text: 'Your personal baseline after 14 days' },
  { icon: 'shield', text: 'Wellness insights — not a medical device' },
];

/** PDF page 1 — Welcome. */
export default function Welcome() {
  return (
    <Screen
      testID="screen-welcome"
      footer={
        <>
          <PrimaryButton
            label="Get started"
            onPress={() => router.push('/onboarding/consent')}
            testID="get-started"
          />
          <TextButton
            label="I already have an account"
            onPress={() => router.push('/sign-in')}
            testID="have-account"
          />
        </>
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          marginTop: space[10] * 2.2,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="pulse" color={colors.white} size={22} strokeWidth={2.4} />
        </View>
        <T variant="heading" style={{ fontSize: 19 }}>
          EdgeVitals
        </T>
      </View>
      <T variant="display" accessibilityRole="header" style={{ marginTop: space[8] }}>
        Know your body's daily rhythm.
      </T>
      <T
        variant="body"
        color={colors.muted}
        style={{ marginTop: space[3], fontSize: 16, lineHeight: 23 }}
      >
        Two short face scans a day. We learn what's normal for you and show how you're trending.
      </T>
      <View style={{ marginTop: space[6], gap: space[4] }}>
        {POINTS.map((p) => (
          <View key={p.icon} style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.small,
                backgroundColor: colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={p.icon} size={20} />
            </View>
            <T variant="body" style={{ flex: 1 }}>
              {p.text}
            </T>
          </View>
        ))}
      </View>
      <T variant="small" color={colors.muted} style={{ marginTop: space[5] }}>
        Camera estimates are not clinically validated. SpO₂ and blood pressure aren't measured by
        the camera yet and will show as unavailable.
      </T>
    </Screen>
  );
}
