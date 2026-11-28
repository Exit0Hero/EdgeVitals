import type { SessionResult } from '@edgevitals/measurement';
import { View } from 'react-native';
import { scanFindings } from '../lib/scanAdvice';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Card, T } from './ui';

/**
 * "What to change next time": the scan's own measured problems, each with
 * the number and one fix. Shown on results whenever a vital was withheld or
 * only came through with low confidence. Nothing here leaves the phone.
 */
export function ScanFeedback({ result }: { result: SessionResult }) {
  const findings = scanFindings(result);
  if (!findings.length) return null;
  return (
    <Card testID="scan-feedback" style={{ marginBottom: space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: 2 }}>
        <Icon name="info" size={18} />
        <T variant="label">What to change next time</T>
      </View>
      <T variant="small" color={colors.muted} style={{ marginBottom: space[3] }}>
        Measured on this scan. Fixing the first item usually helps most.
      </T>
      {findings.slice(0, 4).map((f, i) => (
        <View
          key={f.id}
          testID={`finding-${f.id}`}
          style={{
            flexDirection: 'row',
            gap: space[3],
            paddingVertical: space[3],
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: colors.border,
          }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.pill,
              backgroundColor: colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            <T variant="tiny" color={colors.primary} style={{ fontWeight: '800' }}>
              {String(i + 1)}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <T variant="small" color={colors.textSecondary}>
              {f.finding}
            </T>
            <T variant="small" style={{ fontWeight: '600', marginTop: 2 }}>
              {f.fix}
            </T>
          </View>
        </View>
      ))}
    </Card>
  );
}
