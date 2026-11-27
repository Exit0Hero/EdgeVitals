import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Rect } from 'react-native-svg';
import { api } from '../../api/client';
import { AssessmentHeader } from '../../components/AssessmentHeader';
import { Icon, type IconName } from '../../components/Icon';
import { Loading, PrimaryButton, Screen, Segmented, T } from '../../components/ui';
import { useFlow } from '../../state/flow';
import { colors, radius, space } from '../../theme/tokens';

type ScanType = 'face' | 'finger';

const FINGER_STEPS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'person', title: 'Sit down and rest your hand', sub: 'Rest your forearm on a table' },
  {
    icon: 'camera',
    title: 'Cover the back camera and flash',
    sub: 'Use the pad of a fingertip. Rest it lightly, without pressing',
  },
  {
    icon: 'pulse',
    title: 'Stay still, breathe normally',
    sub: 'About a minute. Warm hands work best',
  },
];

const STEPS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'person', title: 'Sit down and relax', sub: 'Rest for a moment before you start' },
  { icon: 'sun', title: 'Face the camera in even light', sub: 'No strong light behind you' },
  { icon: 'pulse', title: 'Stay still, breathe normally', sub: "Don't talk during the scan" },
];

/** PDF page 7 — Get ready to scan. Explains the camera before the permission prompt (FR-041). */
export default function Prepare() {
  const { assessment: a } = useFlow();
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<ScanType>('face');
  if (!a?.assessmentId) return <Loading />;
  const start = async () => {
    setBusy(true);
    await api.setStatus(a.assessmentId!, 'scan_preparation').catch(() => undefined);
    setBusy(false);
    router.push(type === 'finger' ? '/assessment/finger-scan' : '/assessment/scan');
  };
  const steps = type === 'finger' ? FINGER_STEPS : STEPS;
  return (
    <Screen
      testID="screen-prepare"
      footer={
        <PrimaryButton label="Start scan" onPress={start} loading={busy} testID="start-scan" />
      }
    >
      <AssessmentHeader kind={a.kind} step={1} onBack={() => router.back()} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[4] }}>
        Get ready to scan
      </T>
      <Segmented
        label="Scan type"
        testID="scan-type"
        value={type}
        onChange={setType}
        options={[
          { value: 'face', label: 'Face scan' },
          { value: 'finger', label: 'Finger scan' },
        ]}
      />
      <T
        variant="small"
        color={colors.muted}
        style={{ marginTop: space[2], marginBottom: space[4] }}
      >
        {type === 'finger'
          ? 'Uses the back camera and flash. The signal is much stronger, so HRV and breathing come through more often.'
          : 'Uses the front camera. Easiest, but HRV and breathing may not come through.'}
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
        {type === 'finger' ? (
          <Svg width={120} height={160}>
            {/* Phone back with camera and flash, and a fingertip covering both. */}
            <Rect
              x={20}
              y={6}
              width={80}
              height={148}
              rx={14}
              stroke={colors.primary}
              strokeWidth={2.5}
              fill="none"
            />
            <Circle cx={44} cy={34} r={9} stroke={colors.primary} strokeWidth={2} fill="none" />
            <Circle cx={66} cy={34} r={4} fill={colors.primary} />
            <Ellipse cx={55} cy={40} rx={22} ry={28} fill="#E8A598" opacity={0.75} />
          </Svg>
        ) : (
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
        )}
      </View>
      {steps.map((s) => (
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
        {type === 'finger'
          ? "We'll ask to use your back camera and turn on the flash. The flash can make the phone warm, so the scan stops by itself after about a minute. The video is processed on this device and is never stored or uploaded."
          : "We'll ask to use your front camera. The video is processed on this device and is never stored or uploaded. The scan takes about a minute."}
      </T>
    </Screen>
  );
}
