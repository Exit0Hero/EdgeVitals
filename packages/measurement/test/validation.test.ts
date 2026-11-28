import { describe, expect, it } from 'vitest';
import { ScanSession } from '../src/session';
import { matchIntervals, runValidation } from '../validation/harness';
import { parseTrace } from '../validation/recording';
import { renderMarkdown, SYNTHETIC_BANNER } from '../validation/report';
import { assertNoParticipantLeakage, participantFolds } from '../validation/splits';
import { agreement, coverage, rmssdMs } from '../validation/stats';
import { syntheticFaceSession, syntheticRecording } from '../validation/synthetic';

describe('agreement statistics', () => {
  it('computes MAE, RMSE, bias, SD and Bland-Altman limits', () => {
    const a = agreement([
      { estimate: 61, reference: 60 },
      { estimate: 59, reference: 60 },
      { estimate: 63, reference: 60 },
      { estimate: 61, reference: 60 },
    ]);
    expect(a.n).toBe(4);
    expect(a.bias).toBeCloseTo(1, 10);
    expect(a.mae).toBeCloseTo(1.5, 10);
    expect(a.rmse).toBeCloseTo(Math.sqrt(12 / 4), 10);
    expect(a.sd).toBeCloseTo(Math.sqrt(8 / 3), 10);
    expect(a.loaLower).toBeCloseTo(1 - 1.96 * Math.sqrt(8 / 3), 10);
    expect(a.loaUpper).toBeCloseTo(1 + 1.96 * Math.sqrt(8 / 3), 10);
  });

  it('returns nulls, not zeros, when nothing was reported', () => {
    const a = agreement([]);
    expect(a.mae).toBeNull();
    expect(coverage(0, 0).coverage).toBeNull();
    expect(coverage(10, 4)).toMatchObject({ coverage: 0.4, rejectionRate: 0.6 });
  });

  it('computes RMSSD from intervals', () => {
    expect(rmssdMs([0.8, 0.9, 0.8])).toBeCloseTo(100, 6);
    expect(rmssdMs([0.8])).toBeNull();
  });
});

describe('participant splits', () => {
  const fake = ['A', 'A', 'B', 'C', 'C', 'D'].map((p, i) => ({
    ...syntheticRecording(`r${i}`, p, 'still', { durationSec: 1 }),
  }));

  it('puts every participant in exactly one test fold', () => {
    const folds = participantFolds(fake, 2);
    const tested = folds.flatMap((f) => f.testParticipants).sort();
    expect(tested).toEqual(['A', 'B', 'C', 'D']);
    for (const f of folds) assertNoParticipantLeakage(f.train, f.test);
  });

  it('refuses a split that shares a participant', () => {
    expect(() => assertNoParticipantLeakage([fake[0]!], [fake[1]!])).toThrow(/leakage/);
  });
});

describe('interval matching', () => {
  it('removes the pulse transit delay and matches beats one to one', () => {
    const ref = Array.from({ length: 30 }, (_, i) => i * 0.8);
    const det = ref.map((t, i) => t + 0.2 + (i % 2 ? 0.01 : -0.01));
    const m = matchIntervals(det, ref);
    expect(Math.abs(m.offsetMs! - 200)).toBeLessThanOrEqual(10);
    expect(m.matchedFraction).toBe(1);
    expect(Math.max(...m.errorsMs.map(Math.abs))).toBeLessThan(21);
  });
});

describe('trace import', () => {
  it('reads back a v4 trace exported by ScanSession', () => {
    const { inputs } = syntheticFaceSession({ seed: 5, durationSec: 12 });
    const s = new ScanSession();
    for (const f of inputs) s.pushFrame(f);
    const text = `exposure_lock=1\n${s.exportTrace()}`;
    const rec = parseTrace(text, {
      id: 't',
      participantId: 'P',
      deviceModel: 'x',
      condition: 'c',
      reference: {},
    });
    expect(rec.source).toBe('real');
    expect(rec.frames).toHaveLength(inputs.length);
    const f = rec.frames[100]! as {
      face: { x: number; height: number };
      roi: { regions: { n: number; luma?: number }[] };
    };
    expect(Math.abs(f.face.x - inputs[100]!.faces[0]!.x)).toBeLessThanOrEqual(1);
    expect(f.roi.regions[0]!.n).toBe(500);
    expect(f.roi.regions[0]!.luma!).toBeGreaterThan(100);
  });

  it('rejects text that is not a trace', () => {
    expect(() =>
      parseTrace('hello', {
        id: 't',
        participantId: 'P',
        deviceModel: 'x',
        condition: 'c',
        reference: {},
      }),
    ).toThrow();
  });
});

describe('validation harness on SYNTHETIC recordings', () => {
  const recs = [
    syntheticRecording('a', 'S1', 'still', {
      seed: 1,
      durationSec: 50,
      heartRateBpm: 70,
      pulseAmplitude: 0.008,
      regionNoise: 0.2,
    }),
    syntheticRecording('b', 'S2', 'pulseless', {
      seed: 2,
      durationSec: 50,
      noPulse: true,
      respAmplitude: 0,
      rsaSec: 0,
    }),
  ];
  const report = runValidation(recs);

  it('labels the report synthetic and prints the banner', () => {
    expect(report.synthetic).toBe(true);
    expect(report.sources).toEqual({ synthetic: 2 });
    const md = renderMarkdown(report);
    expect(md).toContain(SYNTHETIC_BANNER);
    expect(md).toMatch(/not\*\* clinical/);
  });

  it('reports coverage and false acceptances per arm', () => {
    const hr = report.arms.find((a) => a.arm === 'hr:pipeline')!;
    expect(hr.coverage.attempted).toBe(1);
    expect(hr.pulselessAttempted).toBe(1);
    expect(hr.falseAcceptances).toBe(0);
    expect(hr.agreement.n).toBe(hr.coverage.reported);
    expect(report.arms.some((a) => a.arm === 'hr:legacy-v0.3')).toBe(true);
    expect(report.arms.some((a) => a.arm === 'hr:chrom:combined')).toBe(true);
  });

  it('never invents a reference: a recording without one is not paired', () => {
    const r = runValidation([{ ...recs[0]!, reference: { pulsePresent: true } }]);
    for (const a of r.arms) expect(a.agreement.n).toBe(0);
  });
});
