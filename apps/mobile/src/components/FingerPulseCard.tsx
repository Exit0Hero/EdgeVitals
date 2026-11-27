import type { SessionResult } from '@edgevitals/measurement';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { colors, space } from '../theme/tokens';
import { PulseWave } from './PulseWave';
import { Card, T } from './ui';

/**
 * Finger scan results extras: the last seconds of the measured pulse with
 * the beats the app detected, and the HRV detail behind the headline value.
 * Kept on the device only (from the in-memory scan result).
 */
export function FingerPulseCard({ result }: { result: SessionResult }) {
  const [w, setW] = useState(0);
  const wave = result.waveform;
  const f = result.diagnostics.finger;
  if (!wave || wave.samples.length < 2 || !f) return null;
  const hrv = result.metrics.find((m) => m.metric === 'hrv');
  const accepted =
    result.diagnostics.ibiAcceptedFraction === null
      ? null
      : Math.round(result.diagnostics.ibiAcceptedFraction * result.diagnostics.ibiCount);
  const seconds = Math.round(wave.samples.length / wave.fs);
  return (
    <Card testID="finger-pulse-card" style={{ marginBottom: space[5] }}>
      <T variant="label" style={{ marginBottom: space[1] }}>
        Your pulse
      </T>
      <T variant="small" color={colors.muted} style={{ marginBottom: space[2] }}>
        The last {seconds} seconds from your fingertip. Dots mark the beats used for HRV.
      </T>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <PulseWave
            samples={wave.samples}
            beats={wave.beats}
            fs={wave.fs}
            width={w}
            height={80}
            testID="finger-result-wave"
            accessibilityLabel={`Pulse waveform with ${wave.beats.length} detected beats`}
          />
        ) : (
          <View style={{ height: 80 }} />
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[3] }}>
        <Stat
          label="RMSSD"
          value={hrv?.status === 'valid' && hrv.value !== null ? `${hrv.value} ms` : '—'}
        />
        <Stat
          label="SDNN"
          value={
            hrv?.status === 'valid' && hrv.valueSecondary !== null
              ? `${hrv.valueSecondary} ms`
              : '—'
          }
        />
        <Stat label="Beats used" value={accepted === null ? '—' : String(accepted)} />
        <Stat
          label="Signal strength"
          value={f.pulseStrengthPct === null ? '—' : `${f.pulseStrengthPct.toFixed(1)}%`}
        />
      </View>
      <T variant="tiny" color={colors.muted} style={{ marginTop: space[2] }}>
        RMSSD tracks short-term, breath-to-breath variation; SDNN the overall variation over the
        minute. Signal strength is how much the image brightness changed with each beat; it shows
        how clear the scan was and is not a health measure.
      </T>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <T variant="tiny" color={colors.muted}>
        {label}
      </T>
      <T variant="label">{value}</T>
    </View>
  );
}
