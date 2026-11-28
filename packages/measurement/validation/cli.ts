/**
 * Offline validation CLI.
 *
 *   npm run validate -w @edgevitals/measurement -- --synthetic --out report.md
 *   npm run validate -w @edgevitals/measurement -- --dir recordings/ --out report.md
 *   npm run validate -w @edgevitals/measurement -- --trace trace.txt --participant P1 \
 *       --device "iQOO Neo 9" --condition daylight [--ref-hr 72] [--ref-br 14]
 *
 * --dir reads every *.json file as a ValidationRecording (recording.ts).
 * --folds k additionally reports each held-out participant fold separately.
 * Writes Markdown to --out (default stdout) and JSON next to it (.json).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runValidation } from './harness';
import { parseTrace, type ValidationRecording } from './recording';
import { renderMarkdown } from './report';
import { participantFolds } from './splits';
import { syntheticDataset } from './syntheticDataset';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

let recordings: ValidationRecording[] = [];
if (has('synthetic')) recordings = syntheticDataset();
const dir = opt('dir');
if (dir)
  for (const f of readdirSync(dir).filter((x: string) => x.endsWith('.json')))
    recordings.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as ValidationRecording);
const trace = opt('trace');
if (trace) {
  const hr = opt('ref-hr');
  const br = opt('ref-br');
  recordings.push(
    parseTrace(readFileSync(trace, 'utf8'), {
      id: trace,
      participantId: opt('participant') ?? 'unknown',
      deviceModel: opt('device') ?? 'unknown',
      condition: opt('condition') ?? 'unknown',
      reference: {
        heartRateBpm: hr ? Number(hr) : undefined,
        breathingPerMin: br ? Number(br) : undefined,
      },
    }),
  );
}
if (!recordings.length) {
  console.error('No recordings. Use --synthetic, --dir <folder> or --trace <file>.');
  process.exit(2);
}

const report = runValidation(recordings);
let md = renderMarkdown(report);
const k = opt('folds');
if (k) {
  for (const [i, fold] of participantFolds(recordings, Number(k)).entries()) {
    const r = runValidation(fold.test, { extractors: false });
    md += `\n\n# Held-out fold ${i + 1} (participants ${fold.testParticipants.join(', ')})\n\n`;
    md += renderMarkdown(r).split('\n').slice(2).join('\n');
  }
}
const out = opt('out');
if (out) {
  writeFileSync(out, md);
  writeFileSync(out.replace(/\.md$/, '') + '.json', JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
} else process.stdout.write(md);
