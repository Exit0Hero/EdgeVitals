import { ScanSession, type LiveScanState } from '@edgevitals/measurement';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api/client';
import { CameraScanner } from '../../camera/CameraScanner';
import type { CameraStatus } from '../../camera/types';
import { Icon } from '../../components/Icon';
import { PrimaryButton, T, TextButton } from '../../components/ui';
import { deviceTimeZone, uuid } from '../../lib/id';
import { toSubmission } from '../../lib/measurements';
import { demoMeasurements } from '../../lib/demo';
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
export default function Scan() {
  const { assessment: a, setAssessment } = useFlow();
  const session = useRef<ScanSession | null>(null);
  const [camStatus, setCamStatus] = useState<CameraStatus>('idle');
  const [camDetail, setCamDetail] = useState<string | undefined>();
  const [live, setLive] = useState<LiveScanState | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [error, setError] = useState<string | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const finishing = useRef(false);

  useEffect(() => {
    api
      .config()
      .then((c) => setDemoEnabled(c.demo_mode_enabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    session.current = new ScanSession();
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
      const result = cancelled ? session.current.cancel() : session.current.finish();
      try {
        if (cancelled) {
          await api.setStatus(a.assessmentId, 'cancelled').catch(() => undefined);
          setAssessment(() => null);
          router.dismissTo('/today');
          return;
        }
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
      if (!s || finishing.current || previewOnly) return;
      try {
        s.pushFrame(f);
      } catch {
        return;
      }
      if (s.shouldFinish()) submit(false);
    },
    [submit, previewOnly],
  );

  const onStatus = useCallback(
    (s: CameraStatus, detail?: string) => {
      setCamStatus(s);
      setCamDetail(detail);
      if (s === 'running') {
        setPhase('scanning');
        if (!previewOnly && a?.assessmentId)
          api.setStatus(a.assessmentId, 'capturing').catch(() => undefined);
      }
      if (s === 'requesting' && a?.assessmentId)
        api.setStatus(a.assessmentId, 'permission_pending').catch(() => undefined);
    },
    [a, previewOnly],
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
        session.current = new ScanSession();
        setLive(null);
        setPhase('interrupted');
        setError('The scan was interrupted because the app left the screen. Nothing was saved.');
      }
    });
    return () => sub.remove();
  }, [phase]);

  const restart = () => {
    session.current = new ScanSession();
    finishing.current = false;
    setError(null);
    setLive(null);
    setPhase('camera');
    setCamStatus('idle');
    setPreviewOnly(false);
  };

  const testPreview = () => {
    session.current = new ScanSession();
    finishing.current = false;
    setError(null);
    setLive(null);
    setPreviewOnly(true);
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
          ? 'Camera preview is running (face processing disabled).'
        : phase === 'scanning' && live
          ? live.guidance
          : phase === 'scanning'
            ? 'Looking for your face…'
            : '';
  const headline =
    q === 'ready' ? 'Keep still' : q === 'motion_too_high' ? 'Hold still' : 'Position your face';
  const elapsed = live ? Math.floor(live.elapsedSec) : 0;

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
          onTestPreview={testPreview}
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
                active={phase === 'camera' || phase === 'scanning'}
                enableProcessing={!previewOnly}
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
                  ? 'Camera preview test — no measurements'
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
                  const value =
                    m === 'heart_rate' && live?.interimHeartRate
                      ? `${live.interimHeartRate} bpm`
                      : null;
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
                            ? 'not available'
                            : st === 'measuring'
                              ? 'measuring…'
                              : 'waiting…')}
                      </T>
                    </View>
                  );
                },
              )}
            </View>
            {previewOnly ? (
              <TextButton label="Exit preview test" onPress={restart} />
            ) : (
              <TextButton
                label="Test camera preview only (no measurements)"
                onPress={testPreview}
                testID="camera-preview-test"
              />
            )}
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
  onTestPreview,
}: {
  status: CameraStatus;
  detail?: string;
  onRetry: () => void;
  onTestPreview: () => void;
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
      {!denied ? (
        <TextButton
          label="Test camera preview only (no face detection)"
          onPress={onTestPreview}
          testID="camera-preview-test"
        />
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
