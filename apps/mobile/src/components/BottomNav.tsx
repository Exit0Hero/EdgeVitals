import { router, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/tokens';
import { Icon } from './Icon';
import { T } from './ui';

/** Bottom navigation from the reference: Today, central assessment action, Trends. */
export function BottomNav() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const tab = (name: 'today' | 'trends', label: string, icon: 'home' | 'chart') => {
    const active = path.startsWith(`/${name}`);
    return (
      <Pressable
        role="link"
        aria-current={active ? 'page' : undefined}
        accessibilityLabel={label}
        onPress={() => router.replace(`/${name}`)}
        style={{ flex: 1, alignItems: 'center', paddingTop: 10, minHeight: 56 }}
        testID={`tab-${name}`}
      >
        <Icon name={icon} color={active ? colors.primary : colors.textSecondary} size={22} />
        <T
          variant="tiny"
          color={active ? colors.primary : colors.textSecondary}
          style={{ marginTop: 3, fontSize: 12 }}
        >
          {label}
        </T>
      </Pressable>
    );
  };
  return (
    <View
      role="navigation"
      aria-label="Main"
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.white,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {tab('today', 'Today', 'home')}
      <View style={{ width: 96, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start assessment"
          onPress={() => router.push('/assessment/check-in')}
          testID="nav-assess"
          style={({ pressed }) => ({
            width: 64,
            height: 64,
            borderRadius: 32,
            marginTop: -22,
            backgroundColor: pressed ? colors.primaryPressed : colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 4,
            borderColor: colors.white,
            shadowColor: colors.primary,
            shadowOpacity: 0.35,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          })}
        >
          <Icon name="pulse" color={colors.white} size={26} strokeWidth={2.4} />
        </Pressable>
      </View>
      {tab('trends', 'Trends', 'chart')}
    </View>
  );
}
