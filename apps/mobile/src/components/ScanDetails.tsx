import type { SessionResult } from '@edgevitals/measurement';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { colors, space } from '../theme/tokens';
import { Card, T, TextButton } from './ui';

const FLAG_LABEL: Record<string, string> = {
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
  lines.push(
    `Usable frames: ${Math.round(d.usableFrameFraction * 100)}% · longest clean stretch: ${d.usableDurationSec.toFixed(1)} s (15 s needed for heart rate, 30 s for HRV and breathing)`,
  );
  const g = d.hrGate;
  if (g) {
    lines.push(
      `Pulse peak: ${g.bpm} bpm · SNR ${g.snrDb} dB (needs ≥ -2) · halves differ ${g.halvesDiffBpm < 0 ? 'n/a' : `${g.halvesDiffBpm} bpm`} (needs ≤ 6)`,
    );
    lines.push(
      `Beats accepted: ${g.beatAcceptedFraction === null ? '—' : `${Math.round(g.beatAcceptedFraction * 100)}%`} (needs ≥ 70%) · beat HR ${g.beatMeanHrBpm ?? '—'} bpm`,
    );
  }
  for (const m of r.metrics) {
    if (m.metric === 'spo2' || m.metric === 'blood_pressure') continue;
    lines.push(
      `${m.metric}: ${m.status === 'valid' ? `${m.value} ${m.unit}` : (m.reason ?? m.status)}`,
    );
  }
  return lines;
}

/** Collapsible "Scan details" card, used to troubleshoot readings on real phones. */
export function ScanDetails({
  result,
  initiallyOpen = false,
}: {
  result: SessionResult;
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
        </View>
      ) : null}
    </Card>
  );
}
