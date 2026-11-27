import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { api } from '../../api/client';
import { AssessmentHeader } from '../../components/AssessmentHeader';
import { Icon, type IconName } from '../../components/Icon';
import { Loading, PrimaryButton, Screen, StatusPill, T } from '../../components/ui';
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

// The face signal is weak on many phones: on the test phone only a scan
// with the phone propped up and the face held still gave a reading.
const STEPS: { icon: IconName; title: string; sub: string }[] = [
  {
    icon: 'person',
    title: 'Prop the phone up',
    sub: 'Lean it on something at face height. A hand-held phone moves too much',
  },
  {
    icon: 'sun',
    title: 'Light your face from the front',
    sub: 'Face a window or lamp. No strong light behind you',
  },
  {
    icon: 'pulse',
    title: 'Keep your head still',
    sub: "Don't talk or look away. Up to 75 seconds if your pulse is faint",
  },
];

const OPTIONS: {
  value: ScanType;
  icon: IconName;
  title: string;
  camera: string;
  detail: string;
  recommended?: boolean;
}[] = [
  {
    value: 'finger',
    icon: 'finger',
    title: 'Finger scan',
    camera: 'Back camera and flash · about 1 min',
    detail:
      'Uses the back camera and flash. The signal is much stronger, so it gives a reading far more often, including HRV and breathing.',
    recommended: true,
  },
  {
    value: 'face',
    icon: 'face',
    title: 'Face scan',
    camera: 'Front camera · 45 to 75 s',
    detail:
      'Uses the front camera. The signal is weak, so it only works with the phone propped up and your head still. HRV and breathing rarely come through.',
  },
];

/** PDF page 7 — Get ready to scan. Explains the camera before the permission prompt (FR-041). */
export default function Prepare() {
  const { assessment: a } = useFlow();
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<ScanType>('finger');
  if (!a?.assessmentId) return <Loading />;
  const start = async () => {
    setBusy(true);
    await api.setStatus(a.assessmentId!, 'scan_preparation').catch(() => undefined);
    setBusy(false);
    router.push(type === 'finger' ? '/assessment/finger-scan' : '/assessment/scan');
  };
  const steps = type === 'finger' ? FINGER_STEPS : STEPS;
  const chosen = OPTIONS.find((o) => o.value === type)!;
  return (
    <Screen
      testID="screen-prepare"
      footer={
        <PrimaryButton
          label={type === 'finger' ? 'Start finger scan' : 'Start face scan'}
          icon="camera"
          onPress={start}
          loading={busy}
          testID="start-scan"
        />
      }
    >
      <AssessmentHeader kind={a.kind} step={1} onBack={() => router.back()} />
      <T variant="title" accessibilityRole="header" style={{ marginBottom: space[1] }}>
        Get ready to scan
      </T>
      <T variant="body" color={colors.muted} style={{ marginBottom: space[5] }}>
        Choose how to measure. You can switch next time.
      </T>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Scan type"
        testID="scan-type"
        style={{ gap: space[3], marginBottom: space[3] }}
      >
        {OPTIONS.map((o) => {
          const selected = o.value === type;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLabel={`${o.title}${o.recommended ? ', recommended' : ''}. ${o.camera}`}
              onPress={() => setType(o.value)}
              testID={`scan-type-${o.value}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                padding: space[4],
                borderRadius: radius.card,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.hero : colors.background,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.control,
                  backgroundColor: selected ? colors.primary : colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  name={o.icon}
                  size={22}
                  color={selected ? colors.white : colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                  <T variant="label" style={{ fontSize: 16 }}>
                    {o.title}
                  </T>
                  {o.recommended ? <StatusPill label="Recommended" tone="success" /> : null}
                </View>
                <T variant="small" color={colors.muted}>
                  {o.camera}
                </T>
              </View>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: selected ? colors.primary : colors.subtle,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected ? (
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: colors.primary,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <T variant="small" color={colors.muted} style={{ marginBottom: space[5] }}>
        {chosen.detail}
      </T>

      <View
        style={{
          backgroundColor: colors.hero,
          borderRadius: radius.card,
          height: 180,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space[5],
          overflow: 'hidden',
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={220} height={180} style={{ position: 'absolute' }}>
          <Circle cx={110} cy={90} r={80} fill={colors.primarySoft} />
          <Circle cx={110} cy={90} r={56} fill={colors.white} opacity={0.6} />
        </Svg>
        <View style={{ position: 'relative' }}>
          {type === 'finger' ? (
            <Svg width={120} height={160}>
              {/* Phone back with camera and flash, and a fingertip resting over both. */}
              <Rect x={24} y={8} width={72} height={144} rx={16} fill={colors.white} />
              <Rect
                x={24}
                y={8}
                width={72}
                height={144}
                rx={16}
                stroke={colors.primary}
                strokeWidth={2.5}
                fill="none"
              />
              <Rect x={34} y={20} width={40} height={30} rx={9} fill={colors.surface} />
              <Circle cx={46} cy={35} r={7} stroke={colors.primary} strokeWidth={2} fill="none" />
              <Circle cx={63} cy={35} r={3.5} fill={colors.warning} />
              <Path d="M36 160 L36 40 a19 19 0 0 1 38 0 L74 160" fill="#E8A598" opacity={0.8} />
              <Path d="M46 34 q9 -6 18 0" stroke="#C97F72" strokeWidth={1.5} fill="none" />
            </Svg>
          ) : (
            <Svg width={120} height={160}>
              <Ellipse
                cx={60}
                cy={78}
                rx={46}
                ry={62}
                stroke={colors.primary}
                strokeWidth={2.5}
                strokeDasharray="6 6"
                fill="none"
              />
              <Ellipse cx={60} cy={78} rx={30} ry={40} fill="#E8C3B4" opacity={0.75} />
              <Circle cx={50} cy={72} r={2.5} fill={colors.textSecondary} />
              <Circle cx={70} cy={72} r={2.5} fill={colors.textSecondary} />
              <Path
                d="M52 94 q8 5 16 0"
                stroke={colors.textSecondary}
                strokeWidth={2}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          )}
        </View>
      </View>

      <T variant="heading" accessibilityRole="header" style={{ marginBottom: space[3] }}>
        Before you start
      </T>
      {steps.map((s, i) => (
        <View
          key={s.title}
          style={{
            flexDirection: 'row',
            gap: space[4],
            alignItems: 'flex-start',
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
              {`${i + 1}. ${s.title}`}
            </T>
            <T variant="small" color={colors.muted}>
              {s.sub}
            </T>
          </View>
        </View>
      ))}
      <View
        style={{
          flexDirection: 'row',
          gap: space[3],
          alignItems: 'flex-start',
          backgroundColor: colors.surface,
          borderRadius: radius.control,
          padding: space[4],
          marginTop: space[1],
        }}
      >
        <Icon name="lock" size={18} color={colors.textSecondary} />
        <T variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
          {type === 'finger'
            ? "We'll ask to use your back camera and turn on the flash. The flash can make the phone warm, so the scan stops by itself after about a minute. The video is processed on this device and is never stored or uploaded."
            : "We'll ask to use your front camera. The video is processed on this device and is never stored or uploaded. The scan takes 45 to 75 seconds."}
        </T>
      </View>
    </Screen>
  );
}
