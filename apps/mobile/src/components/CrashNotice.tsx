import { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, Share, View } from 'react-native';
import { takeCrashReport, type CrashReport } from '../lib/crashRecorder';
import { colors, radius, space } from '../theme/tokens';
import { PrimaryButton, T, TextButton } from './ui';

function describe(r: CrashReport): string {
  return [
    `EdgeVitals crash report (${Platform.OS} ${String(Platform.Version)})`,
    `Time: ${r.at}`,
    `Type: ${r.kind}`,
    `Camera stage: ${r.cameraStage ?? 'none'}`,
    `Message: ${r.message}`,
    r.stack ? `Stack:\n${r.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Shown once after the app closed unexpectedly, so testers can pass the error on. */
export function CrashNotice() {
  const [report, setReport] = useState<CrashReport | null>(null);
  useEffect(() => {
    setReport(takeCrashReport());
  }, []);
  if (!report) return null;
  const text = describe(report);
  return (
    <Modal transparent animationType="fade" onRequestClose={() => setReport(null)}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          padding: space[5],
        }}
      >
        <View
          style={{
            backgroundColor: colors.white,
            borderRadius: radius.card,
            padding: space[5],
            gap: space[3],
            maxHeight: '85%',
          }}
          testID="crash-notice"
        >
          <T variant="heading">The app closed unexpectedly last time</T>
          <T variant="small" color={colors.textSecondary}>
            {report.kind !== 'closed_during_camera'
              ? 'This error was recorded on your phone. Share it with the developer so it can be fixed. It contains no images or health data.'
              : 'The app stopped while the camera was running. Sharing this note tells the developer which camera stage was active.'}
          </T>
          <ScrollView style={{ maxHeight: 260 }}>
            <T variant="small" selectable>
              {text}
            </T>
          </ScrollView>
          <PrimaryButton
            label="Share details"
            onPress={() => {
              Share.share({ message: text }).catch(() => undefined);
            }}
            testID="crash-share"
          />
          <TextButton label="Dismiss" onPress={() => setReport(null)} />
        </View>
      </View>
    </Modal>
  );
}
