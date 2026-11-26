import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { colors, radius, space } from '../theme/tokens';
import { T } from './ui';

export interface TimeFieldProps {
  title: string;
  subtitle: string;
  value: string; // HH:MM
  onChange: (v: string) => void;
  testID?: string;
}

const toDate = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Scan time card with a native time picker (PDF page 4). */
export function TimeField({ title, subtitle, value, onChange, testID }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${value}. Change time`}
        onPress={() => setOpen((o) => !o)}
        testID={testID}
        style={cardStyle}
      >
        <View style={{ flex: 1 }}>
          <T variant="label">{title}</T>
          <T variant="small" color={colors.muted}>
            {subtitle}
          </T>
        </View>
        <View style={chip}>
          <T variant="label" color={colors.primary} style={{ fontSize: 16 }}>
            {value}
          </T>
        </View>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (e.type === 'set' && d) onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
          }}
        />
      ) : null}
    </View>
  );
}

export const cardStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  padding: space[4],
  marginBottom: space[3],
  gap: space[3],
};
export const chip = {
  backgroundColor: colors.primarySoft,
  paddingHorizontal: space[3],
  paddingVertical: space[2],
  borderRadius: radius.small,
};
