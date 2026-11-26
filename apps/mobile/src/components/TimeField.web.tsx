import { createElement } from 'react';
import { View } from 'react-native';
import { colors } from '../theme/tokens';
import { cardStyle, chip, type TimeFieldProps } from './TimeField';
import { T } from './ui';

/** Web: native <input type="time"> styled as the reference chip. */
export function TimeField({ title, subtitle, value, onChange, testID }: TimeFieldProps) {
  return (
    <View style={cardStyle}>
      <View style={{ flex: 1 }}>
        <T variant="label">{title}</T>
        <T variant="small" color={colors.muted}>
          {subtitle}
        </T>
      </View>
      <View style={chip}>
        {createElement('input', {
          type: 'time',
          value,
          'aria-label': `${title} time`,
          'data-testid': testID,
          onChange: (e: { target: { value: string } }) =>
            e.target.value && onChange(e.target.value),
          style: {
            border: 'none',
            background: 'transparent',
            color: colors.primary,
            fontWeight: 600,
            fontSize: 16,
            fontFamily: 'inherit',
            width: 74,
          },
        })}
      </View>
    </View>
  );
}
