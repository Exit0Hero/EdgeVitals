import type { SessionResult } from '@edgevitals/measurement';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { shareTextFile } from '../lib/saveExport';
import { colors, space } from '../theme/tokens';
import { Card, T, TextButton } from './ui';

const FLAG_LABEL: Record<string, string> = {
  finger_not_detected: 'lens not covered',
  too_dark: 'too dark',
  too_bright: 'too bright',
  finger_moving: 'finger moving',
  face_not_found: 'no face',
  multiple_faces: 'several faces',
  face_out_of_region: 'face outside oval',
  lighting_too_low: 'too dark',
  lighting_too_high: 'too bright',
  motion_too_high: 'moving',
  signal_insufficient: 'not enough skin',
};

/** Plain-text summary of why a scan passed or abstained. Aggregates only; no pixels or video. */
export function describeScan(r: SessionResult): string[] {
  const d = r.diagnostics;
  const c = d.capture;
  const lines: string[] = [];
  if (c) {
    const fps = c.medianFrameIntervalMs > 0 ? 1000 / c.medianFrameIntervalMs : 0;
    lines.push(
      `Frames: ${c.frameCount} at ~${fps.toFixed(1)} fps, ${Math.round(d.durationSec)} s captured`,
    );
    const flags = Object.entries(c.flagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([k, n]) => `${FLAG_LABEL[k] ?? k} ${Math.round((100 * n) / Math.max(1, c.frameCount))}%`,
      );
    lines.push(`Frame problems: ${flags.length ? flags.join(', ') : 'none'}`);
    lines.push(
      `Skin pixels per frame: ${c.meanSkinPixels ?? '—'} · brightness: ${c.meanLuma ?? '—'} (of 255)`,
    );
  }
  const f = d.finger;
  if (r.scanType === 'finger' && f) {
    lines.push(
      `Finger scan · usable frames ${Math.round(d.usableFrameFraction * 100)}% · clean stretch ${d.usableDurationSec.toFixed(1)} s (15 s for heart rate, 30 s for HRV and breathing)`,
    );
    lines.push(
      `Lens covered: ${f.meanCoverage === null ? '—' : `${Math.round(f.meanCoverage * 100)}%`} of the image · red clipped in ${Math.round(f.redClippedFraction * 100)}% of frames · channel used: ${f.channel ?? 'none'}`,
    );
    const c = f.channelSnrDb;
    lines.push(
      `Pulse SNR: ${d.hrSnrDb ?? '—'} dB (needs ≥ 6; HRV ≥ 8) · red ${c.r ?? '—'} · green ${c.g ?? '—'} · blue ${c.b ?? '—'}`,
    );
    lines.push(
      `Beats: ${d.ibiCount} intervals, ${d.ibiAcceptedFraction === null ? '—' : `${Math.round(d.ibiAcceptedFraction * 100)}%`} accepted (HR needs ≥ 80%, HRV ≥ 85%) · beat HR ${f.beatMeanHrBpm ?? '—'} bpm · halves differ ${f.halvesDiffBpm ?? '—'} bpm (needs ≤ 5)`,
    );
    lines.push(
      `Beat timing error: ~${f.timingNoiseMs ?? '—'} ms (HRV needs ≤ ${f.timingLimitMs ?? '—'}) · pulse strength ${f.pulseStrengthPct ?? '—'}% · SDNN ${f.sdnnMs ?? '—'} ms`,
    );
    lines.push(
      `Breathing signals: ${
        f.breathing.length
          ? f.breathing
              .map(
                (b) =>
                  `${b.name === 'riiv' ? 'baseline' : b.name === 'riav' ? 'beat size' : 'beat timing'} ${b.perMin ?? '—'}/min (clarity ${Math.round(b.concentration * 100)}%)`,
              )
              .join(' · ')
          : 'not analysed'
      } · two clear signals (≥ 50%) must agree within 2/min`,
    );
    for (const m of r.metrics) {
      if (m.metric === 'spo2' || m.metric === 'blood_pressure') continue;
      lines.push(
        `${m.metric}: ${m.status === 'valid' ? `${m.value} ${m.unit}` : (m.reason ?? m.status)}`,
      );
    }
    return lines;
  }
  lines.push(
    `Usable frames: ${Math.round(d.usableFrameFraction * 100)}% · longest clean stretch: ${d.usableDurationSec.toFixed(1)} s (15 s needed for heart rate, 30 s for HRV and breathing)`,
  );
  const g = d.hrGate;
  if (g) {
    lines.push(
      `Pulse peak: ${g.bpm} bpm · SNR ${g.snrDb} dB (needs ≥ 3) · halves differ ${g.halvesDiffBpm < 0 ? 'n/a' : `${g.halvesDiffBpm} bpm`} (needs ≤ 6)`,
    );
    lines.push(
      `Beats accepted: ${g.beatAcceptedFraction === null ? '—' : `${Math.round(g.beatAcceptedFraction * 100)}%`} (needs ≥ 70%) · beat HR ${g.beatMeanHrBpm ?? '—'} bpm`,
    );
    const c = g.consensus;
    lines.push(
      c
        ? `Window check: ${Math.round(c.agreement * c.windows)} of ${c.windows} windows agree on ${c.bpm} bpm (${Math.round(c.agreement * 100)}%, needs ≥ ${Math.round(c.required * 100)}%) · SNR ${c.snrDb} dB (needs ≥ -2)`
        : 'Window check: needs about 40 s of clean signal',
    );
    lines.push(
      `Heart rate passed by: ${g.acceptedBy === 'consensus' ? 'window check' : g.acceptedBy === 'spectral' ? 'whole-scan peak' : 'neither check'}`,
    );
  }
  const s = d.signal;
  if (s) {
    lines.push(
      `Green only: peak ${s.greenPeakBpm ?? '—'} bpm · SNR ${s.greenSnrDb ?? '—'} dB · pulse-band size ${s.bandAmplitudePct}% (a real pulse is ~0.1-0.5%)`,
    );
    lines.push(
      `Biggest frame-to-frame brightness jump: ${s.maxStepPct}% · frame gaps ${s.intervalP10Ms}-${s.intervalP90Ms} ms`,
    );
    if (s.regionSnrDb) {
      const [fh, lc, rc] = s.regionSnrDb.map((v) => (v === null ? '—' : `${v} dB`));
      lines.push(`Pulse SNR by area: forehead ${fh} · left cheek ${lc} · right cheek ${rc}`);
    }
  }
  const mb = d.motionBreathing;
  if (mb) {
    lines.push(
      `Breathing from head movement: ${mb.perMin ?? '—'}/min · clarity ${Math.round(mb.concentration * 100)}% (needs ≥ 55%) · ${Math.round(mb.agreement * mb.windows)} of ${mb.windows} windows agree (needs ≥ 75%) · movement ${mb.amplitudePct}% of face height · ${mb.passed ? 'passed' : 'not used'}`,
    );
  }
  for (const m of r.metrics) {
    if (m.metric === 'spo2' || m.metric === 'blood_pressure') continue;
    lines.push(
      `${m.metric}: ${m.status === 'valid' ? `${m.value} ${m.unit}${m.qualityFlags.includes('head_motion') ? ' (from head movement)' : ''}` : (m.reason ?? m.status)}`,
    );
  }
  return lines;
}

/** Collapsible "Scan details" card, used to troubleshoot readings on real phones. */
export function ScanDetails({
  result,
  trace = null,
  initiallyOpen = false,
}: {
  result: SessionResult;
  /** Per-frame mean skin colour (three numbers per frame, no images), shared only on request. */
  trace?: string | null;
  /** Open by default after a failed scan so the reason is visible without a tap. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const lines = describeScan(result);
  return (
    <Card tone="surface" testID="scan-details" style={{ marginBottom: space[5] }}>
      <TextButton
        label={open ? 'Hide scan details' : 'Show scan details'}
        onPress={() => setOpen((o) => !o)}
        align="flex-start"
        testID="scan-details-toggle"
      />
      {open ? (
        <View style={{ gap: 4 }}>
          {lines.map((l) => (
            <T key={l} variant="small" color={colors.textSecondary}>
              {l}
            </T>
          ))}
          <TextButton
            label="Share scan details"
            align="flex-start"
            onPress={() => {
              Share.share({
                message: [
                  `EdgeVitals scan details (${Platform.OS} ${String(Platform.Version)})`,
                  ...lines,
                ].join('\n'),
              }).catch(() => undefined);
            }}
          />
          {trace ? (
            <>
              <TextButton
                label="Share signal trace"
                align="flex-start"
                onPress={() => {
                  // As a file: a 45 s trace is ~20 KB, which chat apps cut off as text.
                  shareTextFile(
                    'edgevitals-signal-trace.txt',
                    `EdgeVitals signal trace (${Platform.OS} ${String(Platform.Version)})\n${trace}`,
                    'Share signal trace',
                  ).catch(() => undefined);
                }}
                testID="scan-trace-share"
              />
              <T variant="small" color={colors.muted}>
                The signal trace is a text file with the average colour of each camera frame. It
                contains no images, and it is only shared if you tap the button. Send the file
                itself rather than pasting it, so it is not cut off.
              </T>
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
