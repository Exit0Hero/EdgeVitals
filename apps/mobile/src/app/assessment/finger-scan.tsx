import { FingerScanSession, type FingerLiveState } from '@edgevitals/measurement';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  ScrollView,
  Share,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api/client';
import { getExposureLock } from '../../camera/captureNotes';
import { FingerCamera } from '../../camera/FingerCamera';
import { StartLog, startProblem } from '../../camera/fingerStart';
import type { CameraStatus } from '../../camera/types';
import { Icon } from '../../components/Icon';
import { PulseWave } from '../../components/PulseWave';
import {
  CameraProblem,
  MetricTile,
  ProgressRing,
  QualityStatus,
  ScanNotice,
  ScanSheet,
  ScanTopBar,
  SheetHeader,
  SignalProgress,
  type ScanTone,
} from '../../components/scan';
import { PrimaryButton, T, TextButton } from '../../components/ui';
import { toSubmission } from '../../lib/measurements';
import { rememberScan } from '../../state/lastScan';
import { useFlow } from '../../state/flow';
import { colors, radius, space } from '../../theme/tokens';

const PREVIEW = 132;

type Phase = 'camera' | 'scanning' | 'submitting' | 'interrupted';

const TILES = [
  ['heart_rate', 'Heart rate', 'bpm', 'heart'],
  ['hrv', 'PRV', 'ms', 'pulse'],
  ['breathing_rate', 'Breathing', 'breaths/min', 'wind'],
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
  const [waveW, setWaveW] = useState(0);
  const finishing = useRef(false);
  // Start-up log, shared from the error screen or the scan card.
  const log = useRef(new StartLog());
  const camStatusRef = useRef<CameraStatus>('idle');
  const camDetailRef = useRef<string | undefined>(undefined);
  const openedAt = useRef(Date.now());
  const runningAt = useRef<number | null>(null);
  const frames = useRef(0);

  const shareLog = useCallback(() => {
    Share.share({
      message: [
        `EdgeVitals finger scan start-up log (${Platform.OS} ${String(Platform.Version)})`,
        `status: ${camStatusRef.current}${camDetailRef.current ? ` (${camDetailRef.current})` : ''}`,
        `frames received: ${frames.current}`,
        log.current.text(),
      ].join('\n'),
    }).catch(() => undefined);
  }, []);

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
      frames.current++;
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
      log.current.add(`status: ${s}${detail ? ` (${detail})` : ''}`);
      camStatusRef.current = s;
      camDetailRef.current = detail;
      setCamStatus(s);
      setCamDetail(detail);
      if (s === 'running' && runningAt.current === null) runningAt.current = Date.now();
      // Time spent in the permission dialog does not count toward start-up.
      if (s === 'requesting') openedAt.current = Date.now();
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

  // Start-up watchdog: never sit on a blank screen. If the camera has not
  // started, or started without sending frames, show an error that says so.
  useEffect(() => {
    if (
      camStatus === 'denied' ||
      camStatus === 'unavailable' ||
      camStatus === 'error' ||
      camStatus === 'requesting'
    )
      return;
    const id = setInterval(() => {
      const now = Date.now();
      const p = startProblem(
        now - openedAt.current,
        runningAt.current === null ? null : now - runningAt.current,
        frames.current,
      );
      if (p === 'not_started')
        onStatus(
          'error',
          'The back camera did not start within 10 seconds. Close other camera apps and try again.',
        );
      else if (p === 'no_frames')
        onStatus(
          'error',
          'The back camera started but sent no frames for 5 seconds, so nothing could be measured.',
        );
    }, 1000);
    return () => clearInterval(id);
  }, [camStatus, onStatus, attempt]);

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
    log.current.add('restart');
    openedAt.current = Date.now();
    runningAt.current = null;
    frames.current = 0;
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
  const tone: ScanTone = !live || q === 'starting' ? 'idle' : ok ? 'ok' : 'warn';
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
      edges={['top']}
      testID="screen-finger-scan"
    >
      <ScanTopBar
        eyebrow="Finger scan"
        title={blocked ? 'Camera' : ok ? 'Keep still' : 'Cover the camera'}
        onCancel={() => submit(true)}
        cancelTestID="cancel-finger-scan"
      />

      {blocked ? (
        <CameraProblem
          testID={`finger-camera-${camStatus}`}
          title={camStatus === 'denied' ? 'Camera access is off' : "We can't use the finger scan"}
          body={
            camStatus === 'denied'
              ? 'The finger scan needs the back camera and flash. Allow camera access in your settings, then try again.'
              : (camDetail ?? 'No back camera with a flash is available on this device.')
          }
        >
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
          <TextButton
            label="Share start-up details"
            color={colors.scanMuted}
            onPress={shareLog}
            testID="finger-share-log"
          />
        </CameraProblem>
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: 'center', paddingTop: space[4], gap: space[4] }}
          >
            <ProgressRing size={PREVIEW} progress={live?.progress ?? 0} tone={tone}>
              <FingerCamera
                key={attempt}
                active={phase === 'camera' || phase === 'scanning'}
                onFrame={onFrame}
                onStatus={onStatus}
                size={PREVIEW}
                log={log.current}
              />
            </ProgressRing>
            <QualityStatus
              text={statusText}
              hint={live?.hint ?? null}
              tone={tone}
              testID="finger-quality-status"
            />
            <View
              style={{
                alignSelf: 'stretch',
                marginHorizontal: space[5],
                borderRadius: radius.card,
                backgroundColor: colors.scanSurface,
                padding: space[4],
                gap: space[2],
              }}
              onLayout={(e: LayoutChangeEvent) => setWaveW(e.nativeEvent.layout.width)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Icon name="heart" size={16} color={colors.scanPulse} />
                <T variant="label" color={colors.scanText} style={{ fontSize: 14 }}>
                  Live pulse
                </T>
                <T variant="tiny" color={colors.scanMuted} style={{ marginLeft: 'auto' }}>
                  measured from your fingertip
                </T>
              </View>
              <View style={{ height: 72, justifyContent: 'center', alignItems: 'center' }}>
                {live && live.waveform.length > 1 && waveW > 0 ? (
                  <PulseWave
                    samples={live.waveform}
                    width={waveW - 2 * space[4]}
                    height={72}
                    color={colors.scanPulse}
                    testID="finger-live-wave"
                    accessibilityLabel="Live pulse wave from your fingertip"
                  />
                ) : (
                  <T variant="small" color={colors.scanMuted}>
                    Your pulse wave appears here
                  </T>
                )}
              </View>
            </View>
            {error ? (
              <ScanNotice message={error}>
                <PrimaryButton label="Start again" onPress={restart} />
              </ScanNotice>
            ) : null}
          </ScrollView>
          <ScanSheet testID="finger-scan-card">
            <SheetHeader
              title={phase === 'submitting' ? 'Analysing…' : 'Measuring 3 vital signs'}
              subtitle="Heart rate, PRV and breathing"
              elapsedSec={elapsed}
            />
            <SignalProgress
              progress={live?.progress ?? 0}
              usableSec={phase === 'scanning' && live ? live.usableSec : null}
              targetSec={60}
            />
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              {TILES.map(([m, label, unit, icon]) => {
                const v =
                  m === 'heart_rate'
                    ? live?.interimHeartRate
                    : m === 'hrv'
                      ? live?.interimHrv
                      : live?.interimBreathingRate;
                const st = live?.metrics[m] ?? 'pending';
                return (
                  <MetricTile
                    key={m}
                    icon={icon}
                    label={label}
                    value={v}
                    unit={unit}
                    state={st === 'measuring' ? 'measuring' : 'waiting'}
                    testID={`finger-metric-${m}`}
                  />
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
              <Icon name="flame" size={16} color={colors.subtle} />
              <T variant="small" color={colors.muted} style={{ flex: 1 }}>
                {phase === 'scanning' && live
                  ? `Stops by itself in ${live.secondsLeft} s so the flash doesn't get hot.`
                  : 'About 60 seconds. The flash stays on only while scanning.'}
              </T>
            </View>
            <TextButton
              label="Problems? Share start-up details"
              align="flex-start"
              onPress={shareLog}
              testID="finger-share-log-card"
            />
          </ScanSheet>
        </>
      )}
    </SafeAreaView>
  );
}
