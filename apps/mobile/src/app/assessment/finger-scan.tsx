import { FingerScanSession, type FingerLiveState } from '@edgevitals/measurement';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api/client';
import { getExposureLock } from '../../camera/captureNotes';
import { FingerCamera } from '../../camera/FingerCamera';
import type { CameraStatus } from '../../camera/types';
import { Icon } from '../../components/Icon';
import { PulseWave } from '../../components/PulseWave';
import { PrimaryButton, T, TextButton } from '../../components/ui';
import { toSubmission } from '../../lib/measurements';
import { rememberScan } from '../../state/lastScan';
import { useFlow } from '../../state/flow';
import { colors, radius, space } from '../../theme/tokens';

const PREVIEW = 120;
const WAVE_W = 300;

type Phase = 'camera' | 'scanning' | 'submitting' | 'interrupted';

const TILES = [
  ['heart_rate', 'Heart rate', 'bpm'],
  ['hrv', 'HRV', 'ms'],
  ['breathing_rate', 'Breathing', 'breaths/min'],
] as const;

/**
 * Finger scan (ADR 0010): fingertip over the back camera with the flash on.
 * Every status on this screen comes from a real per-frame check; the wave is
 * the measured signal. The flash is switched off as soon as the scan stops.
 */
export default function FingerScan() {
  const { assessment: a, setAssessment } = useFlow();
  const session = useRef<FingerScanSession>(new FingerScanSession());
  const [camStatus, setCamStatus] = useState<CameraStatus>('idle');
  const [camDetail, setCamDetail] = useState<string | undefined>();
  const [live, setLive] = useState<FingerLiveState | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const finishing = useRef(false);

  useEffect(
    () => () => {
      try {
        session.current.cancel();
      } catch {
        /* already finished */
      }
    },
    [],
  );

  const submit = useCallback(
    async (cancelled: boolean) => {
      if (!a?.assessmentId || finishing.current) return;
      finishing.current = true;
      setPhase('submitting');
      const trace = cancelled
        ? null
        : `exposure_lock=${getExposureLock()}\n${session.current.exportTrace()}`;
      const result = cancelled ? session.current.cancel() : session.current.finish();
      try {
        if (cancelled) {
          await api.setStatus(a.assessmentId, 'cancelled').catch(() => undefined);
          setAssessment(() => null);
          router.dismissTo('/today');
          return;
        }
        rememberScan(a.assessmentId, result, trace);
        await api.submitMeasurements(a.assessmentId, toSubmission(result));
        setAssessment((d) => (d ? { ...d, result } : d));
        router.replace({ pathname: '/assessment/results', params: { id: a.assessmentId } });
      } catch (e) {
        finishing.current = false;
        setError(e instanceof ApiError ? e.message : 'Could not save your results');
        setPhase('interrupted');
      }
    },
    [a, setAssessment],
  );

  const onFrame = useCallback(
    (f: Parameters<FingerScanSession['pushFrame']>[0]) => {
      if (finishing.current) return;
      try {
        session.current.pushFrame(f);
      } catch {
        return;
      }
      if (session.current.shouldFinish()) submit(false);
    },
    [submit],
  );

  const onStatus = useCallback(
    (s: CameraStatus, detail?: string) => {
      setCamStatus(s);
      setCamDetail(detail);
      if (s === 'running') {
        setPhase('scanning');
        if (a?.assessmentId) api.setStatus(a.assessmentId, 'capturing').catch(() => undefined);
      }
      if (s === 'requesting' && a?.assessmentId)
        api.setStatus(a.assessmentId, 'permission_pending').catch(() => undefined);
    },
    [a],
  );

  useEffect(() => {
    if (phase !== 'scanning') return;
    const id = setInterval(() => setLive(session.current.liveState()), 100);
    return () => clearInterval(id);
  }, [phase]);

  // Leaving the screen stops the camera (and the flash) and discards the scan.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && phase === 'scanning') {
        session.current.cancel();
        session.current = new FingerScanSession();
        setLive(null);
        setPhase('interrupted');
        setError('The scan was interrupted because the app left the screen. Nothing was saved.');
      }
    });
    return () => sub.remove();
  }, [phase]);

  const restart = () => {
    session.current = new FingerScanSession();
    finishing.current = false;
    setError(null);
    setLive(null);
    setPhase('camera');
    setCamStatus('idle');
    setCamDetail(undefined);
    setAttempt((n) => n + 1);
  };

  if (!a?.assessmentId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.scanBackground, padding: space[6] }}>
        <T variant="body" color={colors.scanText}>
          No assessment in progress.
        </T>
        <TextButton label="Back to Today" onPress={() => router.dismissTo('/today')} />
      </SafeAreaView>
    );
  }

  const blocked = camStatus === 'denied' || camStatus === 'unavailable' || camStatus === 'error';
  const q = live?.quality;
  const ok = q === 'ready';
  const elapsed = live ? Math.floor(live.elapsedSec) : 0;
  const statusText =
    camStatus === 'requesting'
      ? 'Waiting for camera permission…'
      : phase === 'scanning' && live
        ? live.guidance
        : phase === 'scanning'
          ? 'Starting camera and flash…'
          : '';

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.scanBackground }}
      testID="screen-finger-scan"
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space[5],
          minHeight: 48,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => submit(true)}
          hitSlop={10}
          testID="cancel-finger-scan"
          style={{ minWidth: 64, minHeight: 44, justifyContent: 'center' }}
        >
          <T variant="body" color={colors.scanText} style={{ fontWeight: '500' }}>
            Cancel
          </T>
        </Pressable>
        <T
          variant="label"
          color={colors.scanText}
          style={{ flex: 1, textAlign: 'center' }}
          accessibilityRole="header"
        >
          {blocked ? 'Camera' : ok ? 'Keep still' : 'Cover the camera'}
        </T>
        <View style={{ minWidth: 64 }} />
      </View>

      {blocked ? (
        <View
          style={{ flex: 1, padding: space[6], justifyContent: 'center', gap: space[4] }}
          testID={`finger-camera-${camStatus}`}
        >
          <Icon name="camera" color={colors.scanText} size={36} />
          <T variant="title" color={colors.scanText}>
            {camStatus === 'denied' ? 'Camera access is off' : "We can't use the finger scan"}
          </T>
          <T variant="body" color={colors.scanMuted}>
            {camStatus === 'denied'
              ? 'The finger scan needs the back camera and flash. Allow camera access in your settings, then try again.'
              : (camDetail ?? 'No back camera with a flash is available on this device.')}
          </T>
          {camStatus === 'denied' && Platform.OS !== 'web' ? (
            <PrimaryButton label="Open settings" onPress={() => Linking.openSettings()} />
          ) : null}
          <PrimaryButton label="Try again" onPress={restart} />
          <TextButton
            label="Use the face scan instead"
            color={colors.scanText}
            onPress={() => router.replace('/assessment/scan')}
            testID="finger-use-face"
          />
        </View>
      ) : (
        <>
          <View style={{ alignItems: 'center', marginTop: space[6], gap: space[4] }}>
            <View
              style={{
                padding: 5,
                borderRadius: PREVIEW,
                borderWidth: 3,
                borderColor: ok ? colors.primary : '#5B6573',
              }}
            >
              <FingerCamera
                key={attempt}
                active={phase === 'camera' || phase === 'scanning'}
                onFrame={onFrame}
                onStatus={onStatus}
                size={PREVIEW}
              />
            </View>
            <View
              style={{
                width: WAVE_W,
                height: 84,
                borderRadius: radius.small,
                backgroundColor: colors.scanSurface,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              {live && live.waveform.length > 1 ? (
                <PulseWave
                  samples={live.waveform}
                  width={WAVE_W - 16}
                  height={72}
                  color="#FF6B6B"
                  testID="finger-live-wave"
                  accessibilityLabel="Live pulse wave from your fingertip"
                />
              ) : (
                <T variant="small" color={colors.scanMuted}>
                  Your pulse wave appears here
                </T>
              )}
            </View>
            <Status text={statusText} hint={live?.hint ?? null} ok={ok} />
            {error ? (
              <View style={{ paddingHorizontal: space[6], alignItems: 'center', gap: space[3] }}>
                <T variant="body" color="#F5C38B" style={{ textAlign: 'center' }}>
                  {error}
                </T>
                <PrimaryButton label="Start again" onPress={restart} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }} />
          <View
            style={{
              backgroundColor: colors.white,
              borderRadius: radius.card,
              margin: space[4],
              padding: space[4],
            }}
            testID="finger-scan-card"
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <T variant="heading" style={{ fontSize: 17 }}>
                {phase === 'submitting' ? 'Analysing…' : 'Finger scan'}
              </T>
              <T variant="small" color={colors.muted}>
                {`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
              </T>
            </View>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Clean signal captured"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round((live?.progress ?? 0) * 100),
              }}
              style={{
                height: 6,
                backgroundColor: colors.surface,
                borderRadius: 3,
                marginVertical: space[3],
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${(live?.progress ?? 0) * 100}%`,
                  height: 6,
                  backgroundColor: colors.primary,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              {TILES.map(([m, label, unit]) => {
                const v =
                  m === 'heart_rate'
                    ? live?.interimHeartRate
                    : m === 'hrv'
                      ? live?.interimHrv
                      : live?.interimBreathingRate;
                const st = live?.metrics[m] ?? 'pending';
                return (
                  <View
                    key={m}
                    style={{
                      flex: 1,
                      backgroundColor: colors.surface,
                      borderRadius: radius.small,
                      paddingHorizontal: space[2],
                      paddingVertical: 8,
                    }}
                    testID={`finger-metric-${m}`}
                  >
                    <T variant="tiny" color={colors.textSecondary}>
                      {label}
                    </T>
                    <T
                      variant="small"
                      style={{ fontWeight: v != null ? '700' : '400' }}
                      color={v != null ? colors.text : colors.muted}
                    >
                      {v != null ? `${v} ${unit}` : st === 'measuring' ? 'measuring…' : 'waiting…'}
                    </T>
                  </View>
                );
              })}
            </View>
            <T variant="small" color={colors.muted} style={{ marginTop: space[2] }}>
              {phase === 'scanning' && live
                ? `${Math.floor(live.usableSec)} of 60 seconds of clean signal · stops by itself in ${live.secondsLeft} s so the flash doesn't get hot`
                : 'About 60 seconds. The flash stays on only while scanning.'}
            </T>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Status({ text, hint, ok }: { text: string; hint: string | null; ok: boolean }) {
  const last = useRef('');
  const full = hint ? `${text} ${hint}` : text;
  useEffect(() => {
    if (Platform.OS !== 'ios' || !full || full === last.current) return;
    last.current = full;
    AccessibilityInfo.announceForAccessibility(full);
  }, [full]);
  return (
    <View
      accessibilityLiveRegion="polite"
      aria-live="polite"
      style={{ minHeight: 44, paddingHorizontal: space[6] }}
    >
      <T
        variant="body"
        color={ok ? colors.scanText : '#F5C38B'}
        style={{ textAlign: 'center' }}
        testID="finger-quality-status"
      >
        {text}
      </T>
      {hint ? (
        <T variant="small" color="#F5C38B" style={{ textAlign: 'center', marginTop: 4 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}
