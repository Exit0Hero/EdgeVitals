import { ScanSession, type LiveScanState } from '@edgevitals/measurement';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api/client';
import { CameraScanner } from '../../camera/CameraScanner';
import type { CameraProcessingMode, CameraStatus } from '../../camera/types';
import { Icon } from '../../components/Icon';
import { PrimaryButton, T, TextButton } from '../../components/ui';
import { deviceTimeZone, uuid } from '../../lib/id';
import { toSubmission } from '../../lib/measurements';
import { demoMeasurements } from '../../lib/demo';
import { withSdkVitals } from '../../vitals-sdk';
import { rememberScan } from '../../state/lastScan';
import { getExposureLock } from '../../camera/captureNotes';
import { getExperimentalSpo2 } from '../../lib/experimental';
import { useFlow } from '../../state/flow';
import { colors, radius, space } from '../../theme/tokens';

const PREVIEW = 236;

type Phase = 'camera' | 'scanning' | 'submitting' | 'interrupted';

const TILE_LABEL: Record<string, string> = {
  heart_rate: 'Heart rate',
  breathing_rate: 'Breathing',
  hrv: 'HRV',
  spo2: 'SpO₂',
  blood_pressure: 'Blood pressure',
};

/** PDF page 8 — Active scan. Every status shown here comes from a real check (FR-043, doc 02 p8). */
/**
 * Camera stage tests (preview only, frame output, face detection) were added
 * to track down the Android camera crash. That crash is fixed, so they are
 * hidden unless a build sets EXPO_PUBLIC_CAMERA_DIAGNOSTICS=1.
 */
/** Live pulse-signal strength, shown once 15 s of clean signal exists. Gate: SNR >= -2 dB. */
function pulseSignalText(snrDb: number | null): string {
  if (snrDb === null) return '';
  const label = snrDb >= 3 ? 'strong' : snrDb >= -2 ? 'fair' : 'weak';
  return ` • pulse signal ${label} (${snrDb.toFixed(1)} dB)`;
}

const CAMERA_DIAGNOSTICS = process.env.EXPO_PUBLIC_CAMERA_DIAGNOSTICS === '1';

export default function Scan() {
  const { assessment: a, setAssessment } = useFlow();
  const session = useRef<ScanSession | null>(null);
  const [camStatus, setCamStatus] = useState<CameraStatus>('idle');
  const [camDetail, setCamDetail] = useState<string | undefined>();
  const [live, setLive] = useState<LiveScanState | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [error, setError] = useState<string | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  // Measurements start automatically on every platform. Native frame processing was
  // opt-in on Android until the crash fixed in PR #25 was confirmed gone on a device.
  const [diagnosticMode, setDiagnosticMode] = useState<CameraProcessingMode>('full');
  const [diagnosticText, setDiagnosticText] = useState('');
  const lastDiagnosticUpdate = useRef(-Infinity);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const previewOnly = diagnosticMode !== 'full';
  const finishing = useRef(false);

  useEffect(() => {
    api
      .config()
      .then((c) => setDemoEnabled(c.demo_mode_enabled))
      .catch(() => undefined);
  }, []);

  // Opt-in experimental SpO2 (ADR 0008), read once when the screen opens.
  const experimentalSpo2 = useRef(false);
  const makeSession = useCallback(
    () => new ScanSession(undefined, undefined, { spo2: experimentalSpo2.current }),
    [],
  );
  useEffect(() => {
    let alive = true;
    getExperimentalSpo2().then((on) => {
      if (!alive || on === experimentalSpo2.current) return;
      experimentalSpo2.current = on;
      // Only swap a session that has not started capturing yet.
      if (session.current && session.current.frameCount === 0) session.current = makeSession();
    });
    return () => {
      alive = false;
    };
  }, [makeSession]);

  useEffect(() => {
    session.current = makeSession();
    return () => {
      // Leaving the screen discards any buffered statistics.
      if (session.current && session.current.frameCount >= 0) {
        try {
          session.current.cancel();
        } catch {
          /* already finished */
        }
      }
    };
  }, []);

  const submit = useCallback(
    async (cancelled: boolean) => {
      if (!a?.assessmentId || !session.current || finishing.current) return;
      finishing.current = true;
      setPhase('submitting');
      // Taken before finish(), which clears the per-frame buffer.
      const trace = cancelled
        ? null
        : `exposure_lock=${getExposureLock()}\n${session.current.exportTrace()}`;
      const pipelineResult = cancelled ? session.current.cancel() : session.current.finish();
      try {
        // SpO2 and BP only ever come from a licensed SDK; without one they stay unavailable.
        const result = cancelled ? pipelineResult : await withSdkVitals(pipelineResult);
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
    (f: Parameters<ScanSession['pushFrame']>[0]) => {
      const s = session.current;
      if (previewOnly) {
        // Throttle diagnostic status updates: never run the vital-sign session.
        if (f.t - lastDiagnosticUpdate.current >= 1000) {
          lastDiagnosticUpdate.current = f.t;
          setDiagnosticText(
            diagnosticMode === 'frames'
              ? 'Receiving camera frames without face detection.'
              : `${f.faces.length} face(s) detected; YUV sampling disabled.`,
          );
        }
        return;
      }
      if (!s || finishing.current) return;
      try {
        s.pushFrame(f);
      } catch {
        return;
      }
      if (s.shouldFinish()) submit(false);
    },
    [submit, previewOnly, diagnosticMode],
  );

  const onStatus = useCallback(
    (s: CameraStatus, detail?: string) => {
      // If the processing pipeline reports a recoverable error, immediately return
      // to preview-only mode instead of unmounting the entire camera view.
      if ((s === 'error' || s === 'unavailable') && diagnosticMode !== 'preview') {
        setDiagnosticMode('preview');
        setCamStatus('idle');
        setCamDetail(undefined);
        setDiagnosticText(
          detail
            ? `Measurement processor stopped: ${detail}`
            : 'Measurement processor stopped. Preview mode restored.',
        );
        session.current = makeSession();
        setLive(null);
        setPhase('camera');
        setCameraAttempt((n) => n + 1);
        return;
      }
      setCamStatus(s);
      setCamDetail(detail);
      if (s === 'running') {
        setPhase(previewOnly ? 'camera' : 'scanning');
        if (!previewOnly && a?.assessmentId)
          api.setStatus(a.assessmentId, 'capturing').catch(() => undefined);
      }
      if (s === 'requesting' && a?.assessmentId)
        api.setStatus(a.assessmentId, 'permission_pending').catch(() => undefined);
    },
    [a, previewOnly, diagnosticMode],
  );

  // Refresh the live view 4x per second from real session state.
  useEffect(() => {
    if (phase !== 'scanning') return;
    const id = setInterval(() => session.current && setLive(session.current.liveState()), 250);
    return () => clearInterval(id);
  }, [phase]);

  // Interruption (app backgrounded / tab hidden) cancels capture; the user can restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && phase === 'scanning' && session.current) {
        session.current.cancel();
        session.current = makeSession();
        setLive(null);
        setPhase('interrupted');
        setError('The scan was interrupted because the app left the screen. Nothing was saved.');
      }
    });
    return () => sub.remove();
  }, [phase]);

  const restart = () => {
    session.current = makeSession();
    finishing.current = false;
    setError(null);
    setLive(null);
    setPhase('camera');
    setCamStatus('idle');
    setCamDetail(undefined);
    setCameraAttempt((n) => n + 1);
    setDiagnosticMode('full');
    setDiagnosticText('');
  };

  const testStage = (stage: CameraProcessingMode) => {
    session.current = makeSession();
    finishing.current = false;
    setError(null);
    setLive(null);
    setDiagnosticMode(stage);
    setCameraAttempt((n) => n + 1);
    lastDiagnosticUpdate.current = -Infinity;
    setDiagnosticText('');
    setCamDetail(undefined);
    setCamStatus('idle');
    setPhase('camera');
  };

  const showDemo = async () => {
    if (!a?.assessmentId) return;
    finishing.current = true;
    setPhase('submitting');
    try {
      session.current?.cancel();
      await api.setStatus(a.assessmentId, 'cancelled').catch(() => undefined);
      const demo = await api.createAssessment(
        a.kind,
        a.scheduledFor,
        deviceTimeZone(),
        uuid(),
        true,
      );
      await api.checkIn(
        demo.id,
        a.kind === 'morning'
          ? {
              kind: 'morning',
              sleep_quality: a.sleep,
              energy_rating: a.energy,
              alcohol_previous_evening: a.alcohol,
            }
          : { kind: 'evening', stress_rating: a.stress, energy_rating: a.energy },
      );
      await api.submitMeasurements(demo.id, {
        outcome: 'completed',
        measurements: demoMeasurements(a.kind),
      });
      setAssessment((d) => (d ? { ...d, assessmentId: demo.id } : d));
      router.replace({ pathname: '/assessment/results', params: { id: demo.id } });
    } catch (e) {
      finishing.current = false;
      setError(e instanceof ApiError ? e.message : 'Could not load demo results');
      setPhase('interrupted');
    }
  };

  if (!a?.assessmentId) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.scanBackground,
          justifyContent: 'center',
          padding: space[6],
        }}
      >
        <T variant="body" color={colors.scanText}>
          No assessment in progress.
        </T>
        <TextButton
          label="Back to Today"
          onPress={() => router.dismissTo('/today')}
          color={colors.scanText}
        />
      </SafeAreaView>
    );
  }

  const blocked = camStatus === 'denied' || camStatus === 'unavailable' || camStatus === 'error';
  const q = live?.quality;
  const statusText =
    camStatus === 'requesting'
      ? 'Waiting for camera permission…'
      : camStatus === 'loading_detector'
        ? 'Starting face detection…'
        : previewOnly && camStatus === 'running'
          ? diagnosticMode === 'preview'
            ? diagnosticText || 'Camera ready. Measurements have not started.'
            : diagnosticText || 'Waiting for camera frames…'
          : phase === 'scanning' && live
            ? live.guidance
            : phase === 'scanning'
              ? 'Looking for your face…'
              : '';
  const headline =
    q === 'ready' ? 'Keep still' : q === 'motion_too_high' ? 'Hold still' : 'Position your face';
  const elapsed = live ? Math.floor(live.elapsedSec) : 0;
  const framesReceived = session.current?.frameCount ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.scanBackground }} testID="screen-scan">
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
          testID="cancel-scan"
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
          {blocked ? 'Camera' : headline}
        </T>
        <View style={{ minWidth: 64 }} />
      </View>

      {blocked ? (
        <CameraBlocked
          status={camStatus}
          detail={camDetail}
          onRetry={restart}
          onTestStage={testStage}
        />
      ) : (
        <>
          <View style={{ alignItems: 'center', marginTop: space[8] }}>
            <View
              style={{
                padding: 6,
                borderRadius: PREVIEW,
                borderWidth: 3,
                borderColor: q === 'ready' ? colors.primary : '#5B6573',
              }}
            >
              <CameraScanner
                key={`${diagnosticMode}-${cameraAttempt}`}
                active={phase === 'camera' || phase === 'scanning'}
                enableProcessing={!previewOnly || diagnosticMode !== 'preview'}
                processingMode={diagnosticMode}
                onFrame={onFrame}
                onStatus={onStatus}
                size={PREVIEW}
              />
            </View>
            <LiveStatus text={statusText} ok={q === 'ready'} />
            {error ? (
              <View style={{ paddingHorizontal: space[6], alignItems: 'center', gap: space[3] }}>
                <T variant="body" color="#F5C38B" style={{ textAlign: 'center' }}>
                  {error}
                </T>
                <PrimaryButton label="Start again" onPress={restart} testID="restart-scan" />
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
            testID="scan-card"
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <T variant="heading" style={{ fontSize: 17 }}>
                {previewOnly
                  ? 'Camera preview — measurement paused'
                  : phase === 'submitting'
                    ? 'Analysing…'
                    : 'Measuring 3 of 5 vital signs'}
              </T>
              <T variant="small" color={colors.muted} testID="scan-elapsed">
                {live
                  ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                  : '0:00'}
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
                testID="scan-progress"
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {(['heart_rate', 'breathing_rate', 'hrv', 'spo2', 'blood_pressure'] as const).map(
                (m) => {
                  const st =
                    live?.metrics[m] ??
                    (m === 'spo2' || m === 'blood_pressure' ? 'unavailable' : 'pending');
                  const interim =
                    m === 'heart_rate'
                      ? live?.interimHeartRate
                      : m === 'hrv'
                        ? live?.interimHrv
                        : m === 'breathing_rate'
                          ? live?.interimBreathingRate
                          : null;
                  const value =
                    interim == null
                      ? null
                      : `${interim} ${m === 'heart_rate' ? 'bpm' : m === 'hrv' ? 'ms' : 'breaths/min'}`;
                  return (
                    <View
                      key={m}
                      style={{
                        flexBasis: m === 'blood_pressure' ? '100%' : '48%',
                        flexGrow: 1,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        backgroundColor: colors.surface,
                        borderRadius: radius.small,
                        paddingHorizontal: space[3],
                        paddingVertical: 10,
                      }}
                      testID={`scan-metric-${m}`}
                    >
                      <T variant="small" color={colors.textSecondary}>
                        {TILE_LABEL[m]}
                      </T>
                      <T
                        variant="small"
                        style={{ fontWeight: value ? '700' : '400' }}
                        color={value ? colors.text : colors.muted}
                      >
                        {value ??
                          (st === 'unavailable'
                            ? m === 'blood_pressure' || m === 'spo2'
                              ? 'Not supported yet'
                              : 'No reliable reading'
                            : st === 'measuring'
                              ? 'measuring…'
                              : 'waiting…')}
                      </T>
                    </View>
                  );
                },
              )}
            </View>
            {!previewOnly && phase === 'scanning' ? (
              <T variant="small" color={colors.muted}>
                {framesReceived === 0
                  ? 'Waiting for processed frames. No measurements received yet.'
                  : `${framesReceived} frames processed • ${Math.floor(live?.usableSec ?? 0)} seconds of usable signal (${live?.extended ? 'pulse is weak, scanning up to 75 seconds' : '45 seconds needed'})${pulseSignalText(live?.interimSnrDb ?? null)}`}
              </T>
            ) : null}
            {diagnosticMode === 'preview' ? (
              <PrimaryButton
                label="Start measuring"
                onPress={() => testStage('full')}
                testID="start-measurements"
              />
            ) : null}
            {CAMERA_DIAGNOSTICS ? (
              <>
                <TextButton
                  label="Test camera preview only (no measurements)"
                  onPress={() => testStage('preview')}
                  testID="camera-preview-test"
                />
                <TextButton
                  label="Test frame output (no face detection)"
                  onPress={() => testStage('frames')}
                  testID="camera-frame-test"
                />
                <TextButton
                  label="Test face detection (no YUV sampling)"
                  onPress={() => testStage('face')}
                  testID="camera-face-test"
                />
              </>
            ) : null}
            {previewOnly ? <TextButton label="Restart camera safely" onPress={restart} /> : null}
            {demoEnabled && !previewOnly ? (
              <TextButton
                label="Show demo results (simulated)"
                onPress={showDemo}
                testID="demo-results"
              />
            ) : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function CameraBlocked({
  status,
  detail,
  onRetry,
  onTestStage,
}: {
  status: CameraStatus;
  detail?: string;
  onRetry: () => void;
  onTestStage: (stage: CameraProcessingMode) => void;
}) {
  const denied = status === 'denied';
  return (
    <View
      style={{ flex: 1, padding: space[6], justifyContent: 'center', gap: space[4] }}
      testID={`camera-${status}`}
    >
      <Icon name="camera" color={colors.scanText} size={36} />
      <T variant="title" color={colors.scanText}>
        {denied ? 'Camera access is off' : "We can't use the camera"}
      </T>
      <T variant="body" color={colors.scanMuted}>
        {denied
          ? 'EdgeVitals needs the front camera to scan. Allow camera access in your settings, then try again. Your history and settings are still available.'
          : (detail ?? 'No camera is available on this device.')}
      </T>
      {denied && Platform.OS !== 'web' ? (
        <PrimaryButton label="Open settings" onPress={() => Linking.openSettings()} />
      ) : null}
      <PrimaryButton label="Try again" onPress={onRetry} testID="camera-retry" />
      {!denied && CAMERA_DIAGNOSTICS ? (
        <>
          <TextButton label="Test preview only" onPress={() => onTestStage('preview')} />
          <TextButton label="Test frame output" onPress={() => onTestStage('frames')} />
          <TextButton label="Test face detection" onPress={() => onTestStage('face')} />
        </>
      ) : null}
      <TextButton
        label="Back to Today"
        color={colors.scanText}
        onPress={() => router.dismissTo('/today')}
      />
    </View>
  );
}

/**
 * Framing guidance, announced to screen readers when it changes: a live
 * region on Android and web, an explicit announcement on iOS (no live regions).
 */
function LiveStatus({ text, ok }: { text: string; ok: boolean }) {
  const last = useRef('');
  useEffect(() => {
    if (Platform.OS !== 'ios' || !text || text === last.current) return;
    last.current = text;
    AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return (
    <View
      accessibilityLiveRegion="polite"
      aria-live="polite"
      style={{ marginTop: space[5], minHeight: 44, paddingHorizontal: space[6] }}
    >
      <T
        variant="body"
        color={ok ? colors.scanText : '#F5C38B'}
        style={{ textAlign: 'center' }}
        testID="quality-status"
      >
        {text}
      </T>
    </View>
  );
}
