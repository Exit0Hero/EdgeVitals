/**
 * EdgeVitals design-system primitives (docs/spec/15_DESIGN_SYSTEM.md §4).
 * Every interactive component has pressed, selected, disabled, loading and
 * accessibility states.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, MIN_TOUCH, radius, shadow, space, type } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

export function T({
  children,
  variant = 'body',
  color = colors.text,
  style,
  ...rest
}: {
  children: ReactNode;
  variant?: keyof typeof type;
  color?: string;
  style?: StyleProp<TextStyle>;
  accessibilityRole?: 'header' | 'text' | 'link';
  numberOfLines?: number;
  testID?: string;
  maxFontSizeMultiplier?: number;
  selectable?: boolean;
}) {
  return (
    <Text style={[type[variant], { color }, style]} maxFontSizeMultiplier={1.6} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({
  children,
  footer,
  scroll = true,
  background = colors.background,
  edges = ['top', 'bottom'],
  testID,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  background?: string;
  edges?: ('top' | 'bottom')[];
  testID?: string;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={edges} testID={testID}>
      <View style={styles.frame}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.scrollContent, { flex: 1 }]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </SafeAreaView>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  icon,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      aria-disabled={!!inactive}
      aria-busy={!!loading}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.primary,
        pressed && { backgroundColor: colors.primaryPressed },
        inactive && styles.primaryDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} color={colors.white} size={20} /> : null}
          <T variant="label" color={colors.white} style={{ fontSize: 16 }}>
            {label}
          </T>
        </View>
      )}
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
  color = colors.primary,
  testID,
  align = 'center',
}: {
  label: string;
  onPress: () => void;
  color?: string;
  testID?: string;
  align?: 'center' | 'flex-start' | 'flex-end';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => [
        {
          minHeight: MIN_TOUCH,
          justifyContent: 'center',
          alignItems: align,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <T variant="body" color={color} style={{ fontWeight: '500' }}>
        {label}
      </T>
    </Pressable>
  );
}

export function BackHeader({
  title,
  onBack,
  right,
}: {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ width: MIN_TOUCH }}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={10}
            style={styles.backBtn}
            testID="back"
          >
            <Icon name="chevronLeft" color={colors.text} size={22} />
          </Pressable>
        ) : null}
      </View>
      <T variant="small" color={colors.textSecondary} style={{ flex: 1, textAlign: 'center' }}>
        {title ?? ''}
      </T>
      <View style={{ width: MIN_TOUCH, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** Progress bar under the onboarding/assessment header ("Step 1 of 2", "Check-in / Scan / Results"). */
export function ProgressSteps({
  steps,
  current,
  labels,
}: {
  steps: number;
  current: number;
  labels?: string[];
}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={
        labels
          ? `Step ${current + 1} of ${steps}: ${labels[current]}`
          : `Step ${current + 1} of ${steps}`
      }
      style={{ marginBottom: space[5] }}
    >
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        {Array.from({ length: steps }, (_, i) => (
          <View key={i} style={{ flex: 1 }}>
            <View
              style={[
                styles.stepBar,
                { backgroundColor: i <= current ? colors.primary : colors.border },
              ]}
            />
            {labels ? (
              <T
                variant="tiny"
                color={i === current ? colors.text : colors.muted}
                style={{ marginTop: 6, fontWeight: i === current ? '600' : '400' }}
              >
                {labels[i]}
              </T>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
  tone = 'outline',
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'outline' | 'surface' | 'soft' | 'white';
  testID?: string;
}) {
  const bg = {
    outline: colors.background,
    surface: colors.surface,
    soft: colors.primarySoft,
    white: colors.white,
  }[tone];
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: bg }, tone === 'outline' && styles.cardBorder, style]}
    >
      {children}
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  children,
  testID,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
  testID?: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={accessibilityLabel}
      onPress={onToggle}
      testID={testID}
      style={({ pressed }) => [
        styles.consent,
        checked && { borderColor: colors.primary },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.box,
          checked && { backgroundColor: colors.primary, borderColor: colors.primary },
        ]}
      >
        {checked ? <Icon name="check" color={colors.white} size={14} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  testID,
  label,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
  testID?: string;
  label: string;
}) {
  return (
    <View
      style={styles.segmented}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            testID={testID ? `${testID}-${o.value}` : undefined}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <T
              variant="label"
              color={selected ? colors.text : colors.muted}
              style={{ fontWeight: selected ? '700' : '500' }}
            >
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 1–5 rating with endpoint labels (morning/evening check-in). */
export function RatingScale({
  label,
  value,
  onChange,
  low,
  high,
  testID,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  low: string;
  high: string;
  testID?: string;
}) {
  return (
    <View style={{ marginBottom: space[6] }}>
      <T variant="heading" style={{ marginBottom: space[3] }} accessibilityRole="header">
        {label}
      </T>
      <View
        style={{ flexDirection: 'row', gap: space[2] }}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          const desc = n === 1 ? ` (${low})` : n === 5 ? ` (${high})` : '';
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLabel={`${n}${desc}`}
              onPress={() => onChange(n)}
              testID={testID ? `${testID}-${n}` : undefined}
              style={({ pressed }) => [
                styles.rating,
                selected && styles.ratingSelected,
                pressed && { opacity: 0.8 },
              ]}
            >
              <T
                variant="label"
                color={selected ? colors.primary : colors.text}
                style={{ fontSize: 17, fontWeight: selected ? '700' : '500' }}
              >
                {n}
              </T>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}>
        <T variant="small" color={colors.muted}>
          {low}
        </T>
        <T variant="small" color={colors.muted}>
          {high}
        </T>
      </View>
    </View>
  );
}

export function Field({
  label,
  suffix,
  error,
  testID,
  ...input
}: TextInputProps & { label?: string; suffix?: string; error?: string | null; testID?: string }) {
  return (
    <View style={{ marginBottom: space[5], flex: 1 }}>
      {label ? (
        <T variant="label" style={{ marginBottom: space[2], fontSize: 14 }}>
          {label}
        </T>
      ) : null}
      <View style={[styles.input, error ? { borderColor: colors.danger } : null]}>
        <TextInput
          placeholderTextColor={colors.muted}
          style={styles.inputText}
          accessibilityLabel={label}
          testID={testID}
          maxFontSizeMultiplier={1.6}
          {...input}
        />
        {suffix ? (
          <T variant="body" color={colors.muted}>
            {suffix}
          </T>
        ) : null}
      </View>
      {error ? (
        <T variant="small" color={colors.danger} style={{ marginTop: 4 }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

export type Tone = 'neutral' | 'primary' | 'warning' | 'success' | 'muted';

export function StatusPill({
  label,
  tone = 'primary',
  testID,
}: {
  label: string;
  tone?: Tone;
  testID?: string;
}) {
  const map = {
    primary: [colors.primarySoft, colors.primary],
    warning: [colors.warningSoft, colors.warning],
    success: [colors.successSoft, colors.success],
    neutral: [colors.surface, colors.textSecondary],
    muted: [colors.surface, colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} testID={testID}>
      <T variant="tiny" color={fg} style={{ fontWeight: '700', fontSize: 11.5 }}>
        {label}
      </T>
    </View>
  );
}

export function Banner({
  tone = 'warning',
  title,
  body,
  testID,
}: {
  tone?: 'warning' | 'info' | 'danger';
  title: string;
  body?: string;
  testID?: string;
}) {
  const bg =
    tone === 'warning'
      ? colors.warningSoft
      : tone === 'danger'
        ? colors.dangerSoft
        : colors.primarySoft;
  const fg =
    tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.primary;
  return (
    <View
      style={[styles.banner, { backgroundColor: bg }]}
      accessibilityRole="alert"
      testID={testID}
    >
      <Icon name="alert" color={fg} size={20} />
      <View style={{ flex: 1 }}>
        <T variant="label" color={fg}>
          {title}
        </T>
        {body ? (
          <T variant="small" color={colors.textSecondary} style={{ marginTop: 2 }}>
            {body}
          </T>
        ) : null}
      </View>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8] }}
      accessibilityLabel={label}
    >
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View
      style={{ padding: space[6], alignItems: 'center', gap: space[3] }}
      accessibilityRole="alert"
      testID="error-state"
    >
      <Icon name="alert" color={colors.danger} size={28} />
      <T variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
        {message}
      </T>
      {onRetry ? <TextButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  frame: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' },
  scrollContent: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[6] },
  footer: { paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  primary: {
    minHeight: 56,
    borderRadius: radius.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[5],
    ...shadow.button,
  },
  primaryDisabled: { backgroundColor: '#9DB6EC', shadowOpacity: 0, elevation: 0 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginBottom: space[2] },
  backBtn: { width: MIN_TOUCH, height: MIN_TOUCH, justifyContent: 'center' },
  stepBar: { height: 3, borderRadius: 2 },
  card: { borderRadius: radius.card, padding: space[4] },
  cardBorder: { borderWidth: 1, borderColor: '#ECEEF2', ...shadow.card },
  consent: {
    flexDirection: 'row',
    gap: space[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: space[4],
    marginBottom: space[3],
    alignItems: 'flex-start',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#9AA0A8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.small,
  },
  segmentSelected: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  rating: {
    flex: 1,
    height: 52,
    borderRadius: radius.small + 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  ratingSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space[4],
    minHeight: 52,
    backgroundColor: colors.white,
  },
  inputText: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 12 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  banner: {
    flexDirection: 'row',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.control,
    marginBottom: space[4],
  },
});
