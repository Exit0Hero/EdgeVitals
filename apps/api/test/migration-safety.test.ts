import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Migrations run automatically when a new API version starts, while the
// previous version is still serving (see docs/deployment.md). They must
// therefore be backward compatible with the running version: add tables,
// nullable columns and widened constraints, never drop or rename data.
// A migration that genuinely needs a destructive step must say so on its own
// line, `-- destructive: <reason and the release plan>`, so it gets reviewed
// (with a backup) instead of slipping through.
const dir = join(import.meta.dirname, '..', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bDROP\s+SCHEMA\b/i, 'DROP SCHEMA'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bRENAME\b/i, 'RENAME'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+NOT\s+NULL|TYPE)\b/i, 'ALTER COLUMN … NOT NULL/TYPE'],
];

/** SQL with `--` comments removed, so commented-out text is not flagged. */
function code(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

describe('migrations', () => {
  it('are numbered 001_… with no gaps or duplicates', () => {
    const nums = files.map((f) => Number(/^(\d{3})_[a-z0-9_]+\.sql$/.exec(f)?.[1]));
    expect(nums.every(Number.isInteger)).toBe(true);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it('do not manage their own transactions (the runner wraps each file in one)', () => {
    for (const f of files) {
      const sql = code(readFileSync(join(dir, f), 'utf8'));
      expect(sql, f).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
      // CONCURRENTLY cannot run inside a transaction block.
      expect(sql, f).not.toMatch(/\bCONCURRENTLY\b/i);
    }
  });

  it('are backward compatible unless a destructive step is explicitly annotated', () => {
    const problems: string[] = [];
    for (const f of files) {
      const raw = readFileSync(join(dir, f), 'utf8');
      if (/^--\s*destructive:\s*\S/m.test(raw)) continue;
      const sql = code(raw);
      for (const [re, label] of DESTRUCTIVE) if (re.test(sql)) problems.push(`${f}: ${label}`);
    }
    expect(problems).toEqual([]);
  });
});
