import {
  ASSESSMENT_STATUSES,
  TERMINAL_STATUSES,
  checkInSchema,
  createAssessmentSchema,
  submitMeasurementsSchema,
  type AssessmentStatus,
} from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { Queryable } from '../db';
import { withTransaction } from '../db';
import { ApiError, conflict, forbidden, notFound } from '../errors';
import { parse } from '../validate';
import { consentState } from './me';

const idParam = z.object({ id: z.uuid() });
const SUPPORTED_COUNT = 3; // heart_rate, hrv, breathing_rate (ADR 0004)

/** Allowed client-driven transitions; completed/partial only come from a measurement submission. */
const ORDER: AssessmentStatus[] = [
  'not_started',
  'check_in_in_progress',
  'check_in_complete',
  'scan_preparation',
  'permission_pending',
  'capturing',
  'quality_check',
  'processing',
];

function canTransition(from: AssessmentStatus, to: AssessmentStatus): boolean {
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (to === 'cancelled' || to === 'failed') return true;
  if (to === 'completed' || to === 'partial') return false;
  // Forward moves, or back to an earlier pre-capture step (user navigates back).
  return ORDER.indexOf(to) >= 0 && to !== from;
}

async function getOwned(db: Queryable, id: string, userId: string, lock = false) {
  const { rows } = await db.query(
    `SELECT * FROM assessments WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [id, userId],
  );
  // 404 (not 403) for other users' assessments: do not reveal existence.
  if (!rows.length) throw notFound('Assessment');
  return rows[0];
}

async function present(db: Queryable, a: Record<string, unknown>) {
  const [{ rows: ci }, { rows: ms }] = await Promise.all([
    db.query(
      'SELECT kind, sleep_quality, energy_rating, stress_rating, alcohol_previous_evening, created_at, updated_at FROM check_ins WHERE assessment_id = $1',
      [a.id],
    ),
    db.query(
      `SELECT metric, status, value_numeric AS value, value_secondary, unit, quality_score, quality_flags, reason, method,
              algorithm_name, algorithm_version, config_version, validation, measured_at
         FROM measurements WHERE assessment_id = $1 ORDER BY metric`,
      [a.id],
    ),
  ]);
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    scheduled_for: a.scheduled_for,
    started_at: a.started_at,
    completed_at: a.completed_at,
    timezone: a.timezone,
    attempt_number: a.attempt_number,
    demo: a.demo,
    check_in: ci[0] ?? null,
    measurements: ms,
  };
}

export async function assessmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    await app.authenticate(req);
  });

  app.post('/', async (req, reply) => {
    const uid = req.userId!;
    const body = parse(createAssessmentSchema, req.body);
    const key = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100) ?? null;
    if (body.demo && !app.config.demoModeEnabled)
      throw forbidden('demo_disabled', 'Demo mode is not enabled');
    const consents = await consentState(app.db, uid);
    if (!consents.requiredGranted)
      throw forbidden('consent_required', 'Required consent must be granted before assessments');

    const row = await withTransaction(app.db, async (c) => {
      if (key) {
        const { rows } = await c.query(
          'SELECT * FROM assessments WHERE user_id = $1 AND idempotency_key = $2',
          [uid, key],
        );
        if (rows.length) return { row: rows[0], created: false };
      }
      // Lock the user's row so concurrent creates get distinct attempt numbers.
      await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [uid]);
      const { rows: prev } = await c.query(
        'SELECT COUNT(*)::int AS n FROM assessments WHERE user_id = $1 AND kind = $2 AND scheduled_for = $3',
        [uid, body.kind, body.scheduled_for],
      );
      const { rows } = await c.query(
        `INSERT INTO assessments (user_id, kind, scheduled_for, timezone, attempt_number, demo, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [uid, body.kind, body.scheduled_for, body.timezone, prev[0].n + 1, body.demo ?? false, key],
      );
      await audit(c, uid, 'assessment.started', {
        assessment_id: rows[0].id,
        kind: body.kind,
        attempt: prev[0].n + 1,
      });
      return { row: rows[0], created: true };
    });
    return reply.status(row.created ? 201 : 200).send(await present(app.db, row.row));
  });

  app.get('/', async (req) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().max(200).optional(),
      }),
      req.query,
    );
    let after: { t: string; id: string } | null = null;
    if (q.cursor) {
      try {
        after = JSON.parse(Buffer.from(q.cursor, 'base64url').toString());
      } catch {
        throw new ApiError(400, 'malformed_request', 'Invalid cursor');
      }
    }
    const { rows } = await app.db.query(
      `SELECT * FROM assessments WHERE user_id = $1
         AND ($2::timestamptz IS NULL OR (started_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY started_at DESC, id DESC LIMIT $4`,
      [
        req.userId,
        after?.t ?? null,
        after?.id ?? '00000000-0000-0000-0000-000000000000',
        q.limit + 1,
      ],
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => present(app.db, r))),
      next_cursor:
        rows.length > q.limit && last
          ? Buffer.from(
              JSON.stringify({ t: new Date(last.started_at).toISOString(), id: last.id }),
            ).toString('base64url')
          : null,
    };
  });

  app.get('/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return present(app.db, await getOwned(app.db, id, req.userId!));
  });

  app.patch('/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(ASSESSMENT_STATUSES) }), req.body);
    const row = await withTransaction(app.db, async (c) => {
      const a = await getOwned(c, id, req.userId!, true);
      if (!canTransition(a.status, status))
        throw conflict('invalid_transition', `Cannot move from ${a.status} to ${status}`);
      const terminal = TERMINAL_STATUSES.includes(status);
      const { rows } = await c.query(
        `UPDATE assessments SET status = $2, completed_at = CASE WHEN $3 THEN now() ELSE completed_at END WHERE id = $1 RETURNING *`,
        [id, status, terminal],
      );
      if (status === 'cancelled')
        await audit(c, req.userId!, 'assessment.cancelled', { assessment_id: id });
      return rows[0];
    });
    return present(app.db, row);
  });

  app.post('/:id/check-in', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const ci = parse(checkInSchema, req.body);
    const out = await withTransaction(app.db, async (c) => {
      const a = await getOwned(c, id, req.userId!, true);
      if (a.kind !== ci.kind)
        throw new ApiError(422, 'validation_failed', `This is a ${a.kind} assessment`);
      if (TERMINAL_STATUSES.includes(a.status))
        throw conflict('assessment_closed', 'Check-in can no longer be changed');
      const existed =
        (await c.query('SELECT 1 FROM check_ins WHERE assessment_id = $1', [id])).rows.length > 0;
      await c.query(
        `INSERT INTO check_ins (assessment_id, kind, sleep_quality, energy_rating, stress_rating, alcohol_previous_evening)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (assessment_id) DO UPDATE SET sleep_quality = $3, energy_rating = $4, stress_rating = $5,
           alcohol_previous_evening = $6, updated_at = now()`,
        [
          id,
          ci.kind,
          ci.kind === 'morning' ? ci.sleep_quality : null,
          ci.energy_rating,
          ci.kind === 'evening' ? ci.stress_rating : null,
          ci.kind === 'morning' ? ci.alcohol_previous_evening : null,
        ],
      );
      if (ORDER.indexOf(a.status) < ORDER.indexOf('check_in_complete'))
        await c.query("UPDATE assessments SET status = 'check_in_complete' WHERE id = $1", [id]);
      if (existed) await audit(c, req.userId!, 'check_in.corrected', { assessment_id: id });
      return {
        a: (await c.query('SELECT * FROM assessments WHERE id = $1', [id])).rows[0],
        existed,
      };
    });
    return reply.status(out.existed ? 200 : 201).send(await present(app.db, out.a));
  });

  app.post('/:id/measurements', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(submitMeasurementsSchema, req.body);
    const metrics = body.measurements.map((m) => m.metric);
    if (new Set(metrics).size !== metrics.length)
      throw new ApiError(422, 'validation_failed', 'Duplicate metric');

    const row = await withTransaction(app.db, async (c) => {
      const a = await getOwned(c, id, req.userId!, true);
      if (TERMINAL_STATUSES.includes(a.status))
        throw conflict('already_submitted', 'Results were already submitted');
      if (a.demo) {
        if (body.measurements.some((m) => m.status === 'valid' || m.method !== 'demo_fixture'))
          throw new ApiError(
            422,
            'validation_failed',
            'Demo assessments accept only demo fixtures',
          );
      } else if (
        body.measurements.some((m) => m.status === 'simulated' || m.method === 'demo_fixture')
      ) {
        throw new ApiError(
          422,
          'simulated_rejected',
          'Simulated values cannot be stored as measurements',
        );
      }
      const withValue = body.measurements.filter((m) => m.value !== null).length;
      let status: AssessmentStatus;
      if (body.outcome === 'cancelled') {
        if (withValue > 0)
          throw new ApiError(422, 'validation_failed', 'A cancelled scan cannot carry values');
        status = 'cancelled';
      } else {
        status =
          withValue === 0 ? 'failed' : withValue >= SUPPORTED_COUNT ? 'completed' : 'partial';
      }
      for (const m of body.measurements) {
        await c.query(
          `INSERT INTO measurements (assessment_id, metric, value_numeric, value_secondary, unit, status, quality_score,
             quality_flags, reason, method, algorithm_name, algorithm_version, config_version, validation, measured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            id,
            m.metric,
            m.value,
            m.value_secondary ?? null,
            m.unit,
            m.status,
            m.quality_score,
            JSON.stringify(m.quality_flags),
            m.reason,
            m.method,
            m.algorithm_name,
            m.algorithm_version,
            m.config_version,
            m.validation,
            m.measured_at,
          ],
        );
      }
      const { rows } = await c.query(
        'UPDATE assessments SET status = $2, completed_at = now(), scan_diagnostics = $3 WHERE id = $1 RETURNING *',
        [id, status, body.diagnostics ? JSON.stringify(body.diagnostics) : null],
      );
      await audit(c, req.userId!, `assessment.${status}`, {
        assessment_id: id,
        algorithm_versions: [
          ...new Set(body.measurements.map((m) => `${m.algorithm_name}@${m.algorithm_version}`)),
        ],
      });
      return rows[0];
    });
    return reply.status(201).send(await present(app.db, row));
  });
}
