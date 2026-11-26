import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { api } from '../../api/client';
import { AssessmentHeader } from '../../components/AssessmentHeader';
import { Icon, type IconName } from '../../components/Icon';
import { Loading, PrimaryButton, Screen, T } from '../../components/ui';
import { useFlow } from '../../state/flow';
import { colors, radius, space } from '../../theme/tokens';

const STEPS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'person', title: 'Sit down and relax', sub: 'Rest for a moment before you start' },
  { icon: 'sun', title: 'Face the camera in even light', sub: 'No strong light behind you' },
  { icon: 'pulse', title: 'Stay still, breathe normally', sub: "Don't talk during the scan" },
];

/** PDF page 7 — Get ready to scan. Explains the camera before the permission prompt (FR-041). */
export default function Prepare() {
  const { assessment: a } = useFlow();
  const [busy, setBusy] = useState(false);
  if (!a?.assessmentId) return <Loading />;
  const start = async () => {
    setBusy(true);
    await api.setStatus(a.assessmentId!, 'scan_preparation').catch(() => undefined);
    setBusy(false);
    router.push('/assessment/scan');
  };
  return (
    <Screen
      testID="screen-prepare"
      footer={
        <PrimaryButton label="Start scan" onPress={start} loading={busy} testID="start-scan" />
      }
    >
      <AssessmentHeader kind={a.kind} step={1} onBack={() => router.back()} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[5] }}>
        Get ready to scan
      </T>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          height: 190,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space[6],
        }}
        accessibilityElementsHidden
      >
        <Svg width={120} height={160}>
          <Ellipse
            cx={60}
            cy={80}
            rx={56}
            ry={76}
            stroke={colors.primary}
            strokeWidth={2.5}
            strokeDasharray="5 5"
            fill="none"
          />
        </Svg>
      </View>
      {STEPS.map((s) => (
        <View
          key={s.title}
          style={{
            flexDirection: 'row',
            gap: space[4],
            alignItems: 'center',
            marginBottom: space[4],
          }}
        >
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
            <Icon name={s.icon} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="label" style={{ fontSize: 16 }}>
              {s.title}
            </T>
            <T variant="small" color={colors.muted}>
              {s.sub}
            </T>
          </View>
        </View>
      ))}
      <T variant="small" color={colors.muted} style={{ marginTop: space[2] }}>
        We'll ask to use your front camera. The video is processed on this device and is never
        stored or uploaded. The scan takes about a minute.
      </T>
    </Screen>
  );
}
