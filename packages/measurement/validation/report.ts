/** Markdown rendering of a ValidationReport. */
import type { ArmSummary, ValidationReport } from './harness';
import type { AgreementStats } from './stats';

const f = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(dp);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(100 * v).toFixed(1)}%`;

export const SYNTHETIC_BANNER =
  '> **SYNTHETIC DATA: software verification only.** These recordings are generated test ' +
  'signals with known ground truth. The numbers show whether the code behaves as designed on ' +
  'signals that match its assumptions. They are **not** clinical or reference-device ' +
  'validation and must never be quoted as accuracy.';

function row(name: string, a: AgreementStats, cov: number | null | undefined) {
  return `| ${name} | ${a.n} | ${pct(cov)} | ${f(a.mae)} | ${f(a.rmse)} | ${f(a.bias)} | ${f(a.sd)} | ${f(a.loaLower)} to ${f(a.loaUpper)} |`;
}

const HEAD =
  '| | Paired n | Coverage | MAE | RMSE | Bias | SD | 95% limits of agreement |\n|---|---|---|---|---|---|---|---|';

function armSection(a: ArmSummary): string {
  const lines = [
    `### ${a.arm}`,
    '',
    `Coverage ${a.coverage.reported}/${a.coverage.attempted} (${pct(a.coverage.coverage)}), rejection rate ${pct(a.coverage.rejectionRate)}. ` +
      `False acceptances on pulseless recordings: ${a.falseAcceptances}/${a.pulselessAttempted}.`,
    '',
    HEAD,
    row('All', a.agreement, a.coverage.coverage),
  ];
  for (const [title, groups] of [
    ['participant', a.byParticipant],
    ['device', a.byDevice],
    ['condition', a.byCondition],
  ] as const)
    for (const [k, s] of Object.entries(groups)) lines.push(row(`${title}: ${k}`, s, s.coverage));
  return lines.join('\n');
}

export function renderMarkdown(r: ValidationReport): string {
  const out = [
    `# EdgeVitals measurement validation report`,
    '',
    r.synthetic ? SYNTHETIC_BANNER : '> Real recordings with reference measurements.',
    '',
    `Generated ${r.generatedAt} · pipeline ${r.pipelineVersion} · config ${r.configVersion}`,
    `Recordings: ${r.recordings} (${Object.entries(r.sources)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}) · participants: ${r.participants}`,
    '',
    'Units: heart rate bpm, breathing /min, intervals ms. Errors are estimate minus reference. ' +
      'Error statistics use only recordings where a value was reported, so read them together with coverage.',
    '',
    'Arms: `hr:pipeline` and `br:pipeline` are what the app reports. `*:legacy-v0.3` is the previous ' +
      'estimator on the same recording. `hr:<method>:<region>` is one extractor on one region with a fixed ' +
      '3 dB whole-scan SNR gate (the v0.3 spectral gate); it compares extractors, it is not a product path.',
    '',
  ];
  if (r.synthetic)
    out.push(
      'Synthetic caveats: the simulated pulse uses one fixed colour signature, which is exactly the ' +
        'signature PBV assumes, so PBV is favoured here. The breathing head movement is a clean sinusoid, ' +
        'so breathing errors here are much smaller than any real capture would give.',
      '',
    );
  for (const group of ['hr:', 'br:']) {
    out.push(group === 'hr:' ? '## Heart rate' : '## Breathing rate', '');
    for (const a of r.arms.filter((x) => x.arm.startsWith(group))) out.push(armSection(a), '');
  }
  out.push('## Pulse intervals (camera PRV vs reference beats)', '');
  if (!r.intervals) out.push('No recording had reference beat times.');
  else {
    out.push(
      `Recordings with reference beats: ${r.intervals.recordings}; mean share of detected beats matched: ${pct(r.intervals.meanMatchedFraction)}. ` +
        'Interval errors cover every interval the beat detector accepted, including recordings where PRV ' +
        'itself was withheld; RMSSD covers only values the app would report.',
      '',
      HEAD,
      row('Interval error (accepted intervals)', r.intervals.agreement, null),
      row('RMSSD (reported values)', r.intervals.rmssd, null),
    );
  }
  return out.join('\n') + '\n';
}
