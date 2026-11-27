import {
  CONSENT_TYPES,
  REQUIRED_CONSENTS,
  consentGrantSchema,
  profilePatchSchema,
  profileSchema,
  scheduleSchema,
} from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { Queryable } from '../db';
import { withTransaction } from '../db';
import { verifyPassword } from '../auth/passwords';
import { ApiError, forbidden, notFound } from '../errors';
import { parse } from '../validate';

const idParam = z.object({ id: z.uuid() });

export async function consentState(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (consent_type) id, consent_type, granted, policy_version, recorded_at, withdrawn_at
       FROM consent_records WHERE user_id = $1 ORDER BY consent_type, recorded_at DESC`,
    [userId],
  );
  const state = Object.fromEntries(
    CONSENT_TYPES.map((t) => {
      const r = rows.find((x) => x.consent_type === t);
      return [
        t,
        {
          active: !!r && r.granted && !r.withdrawn_at,
          record_id: r?.id ?? null,
          policy_version: r?.policy_version ?? null,
        },
      ];
    }),
  ) as Record<
    (typeof CONSENT_TYPES)[number],
    { active: boolean; record_id: string | null; policy_version: string | null }
  >;
  return { state, requiredGranted: REQUIRED_CONSENTS.every((t) => state[t].active) };
}

function profileOut(p: Record<string, unknown> | undefined) {
  if (!p) return null;
  return {
    birth_year: p.birth_year,
    sex_at_birth: p.sex_at_birth,
    height_cm: p.height_cm === null ? null : Number(p.height_cm),
    weight_kg: p.weight_kg === null ? null : Number(p.weight_kg),
    updated_at: p.updated_at,
  };
}

function scheduleOut(s: Record<string, unknown> | undefined) {
  if (!s) return null;
  return {
    morning_time: String(s.morning_time).slice(0, 5),
    evening_time: String(s.evening_time).slice(0, 5),
    timezone: s.timezone,
    reminders_enabled: s.reminders_enabled,
    heart_rate_affecting_substance: s.heart_rate_affecting_substance,
  };
}

/** Everything we hold about a user, for export (docs 11 §6). */
async function collectExport(db: Queryable, userId: string) {
  const one = async (sql: string) => (await db.query(sql, [userId])).rows;
  return {
    format: 'edgevitals-export-v1',
    generated_at: new Date().toISOString(),
    account: (await one('SELECT id, email, created_at, timezone FROM users WHERE id = $1'))[0],
    profile:
      (
        await one(
          'SELECT birth_year, sex_at_birth, height_cm, weight_kg, updated_at FROM profiles WHERE user_id = $1',
        )
      )[0] ?? null,
    schedule:
      (await one('SELECT * FROM schedules WHERE user_id = $1')).map(
        ({ user_id: _u, ...s }) => s,
      )[0] ?? null,
    consents: await one(
      'SELECT consent_type, granted, policy_version, source, recorded_at, withdrawn_at FROM consent_records WHERE user_id = $1 ORDER BY recorded_at',
    ),
    assessments: await one(
      `SELECT a.id, a.kind, a.status, a.scheduled_for, a.started_at, a.completed_at, a.timezone, a.attempt_number, a.demo,
              to_jsonb(c) - 'id' - 'assessment_id' AS check_in,
              COALESCE((SELECT jsonb_agg(to_jsonb(m) - 'id' - 'assessment_id') FROM measurements m WHERE m.assessment_id = a.id), '[]') AS measurements
         FROM assessments a LEFT JOIN check_ins c ON c.assessment_id = a.id
        WHERE a.user_id = $1 ORDER BY a.started_at`,
    ),
    cuff_blood_pressure: await one(
      'SELECT systolic, diastolic, pulse_bpm, measured_at, created_at FROM cuff_bp_readings WHERE user_id = $1 ORDER BY measured_at',
    ),
    audit_events: await one(
      'SELECT event_type, created_at FROM audit_events WHERE user_id = $1 ORDER BY created_at',
    ),
  };
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (req.routeOptions.config && (req.routeOptions.config as { public?: boolean }).public) return;
    await app.authenticate(req);
  });

  app.get('/', async (req) => {
    const uid = req.userId!;
    const [{ rows: u }, { rows: p }, { rows: s }] = await Promise.all([
      app.db.query('SELECT id, email, created_at, timezone FROM users WHERE id = $1', [uid]),
      app.db.query('SELECT * FROM profiles WHERE user_id = $1', [uid]),
      app.db.query('SELECT * FROM schedules WHERE user_id = $1', [uid]),
    ]);
    const consents = await consentState(app.db, uid);
    const profile = profileOut(p[0]);
    const schedule = scheduleOut(s[0]);
    return {
      ...u[0],
      profile,
      schedule,
      consents: consents.state,
      required_consents_granted: consents.requiredGranted,
      onboarding_complete: consents.requiredGranted && !!profile && !!schedule,
    };
  });

  app.patch('/profile', async (req) => {
    const uid = req.userId!;
    const existing = (await app.db.query('SELECT * FROM profiles WHERE user_id = $1', [uid]))
      .rows[0];
    const patch = parse(profilePatchSchema, req.body);
    // The first write must be complete; later writes may be partial.
    const merged = existing
      ? { ...profileOut(existing), ...patch }
      : parse(profileSchema, req.body);
    const full = parse(profileSchema, {
      birth_year: merged.birth_year,
      sex_at_birth: merged.sex_at_birth,
      height_cm: merged.height_cm,
      weight_kg: merged.weight_kg,
    });
    const { rows } = await app.db.query(
      `INSERT INTO profiles (user_id, birth_year, sex_at_birth, height_cm, weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET birth_year = $2, sex_at_birth = $3, height_cm = $4, weight_kg = $5, updated_at = now()
       RETURNING *`,
      [uid, full.birth_year, full.sex_at_birth, full.height_cm, full.weight_kg],
    );
    await audit(app.db, uid, 'profile.changed', { fields: Object.keys(patch) });
    return profileOut(rows[0]);
  });

  app.get('/consents', async (req) => {
    const { rows } = await app.db.query(
      'SELECT id, consent_type, granted, policy_version, source, recorded_at, withdrawn_at FROM consent_records WHERE user_id = $1 ORDER BY recorded_at DESC',
      [req.userId],
    );
    const s = await consentState(app.db, req.userId!);
    return { current: s.state, required_consents_granted: s.requiredGranted, records: rows };
  });

  app.post('/consents', async (req, reply) => {
    const body = parse(consentGrantSchema, req.body);
    const { rows } = await app.db.query(
      `INSERT INTO consent_records (user_id, consent_type, granted, policy_version, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, consent_type, granted, policy_version, source, recorded_at, withdrawn_at`,
      [req.userId, body.consent_type, body.granted, body.policy_version, body.source],
    );
    await audit(app.db, req.userId!, body.granted ? 'consent.granted' : 'consent.declined', {
      consent_type: body.consent_type,
      policy_version: body.policy_version,
    });
    return reply.status(201).send(rows[0]);
  });

  app.post('/consents/:id/withdraw', async (req) => {
    const { id } = parse(idParam, req.params);
    const { rows } = await app.db.query(
      `UPDATE consent_records SET withdrawn_at = now()
        WHERE id = $1 AND user_id = $2 AND withdrawn_at IS NULL
        RETURNING id, consent_type, granted, policy_version, recorded_at, withdrawn_at`,
      [id, req.userId],
    );
    if (!rows.length) throw notFound('Consent record');
    await audit(app.db, req.userId!, 'consent.withdrawn', { consent_type: rows[0].consent_type });
    return rows[0];
  });

  app.get('/schedule', async (req) => {
    const { rows } = await app.db.query('SELECT * FROM schedules WHERE user_id = $1', [req.userId]);
    if (!rows.length) throw notFound('Schedule');
    return scheduleOut(rows[0]);
  });

  app.put('/schedule', async (req) => {
    const s = parse(scheduleSchema, req.body);
    const uid = req.userId!;
    const row = await withTransaction(app.db, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO schedules (user_id, morning_time, evening_time, timezone, reminders_enabled, heart_rate_affecting_substance)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET morning_time = $2, evening_time = $3, timezone = $4,
           reminders_enabled = $5, heart_rate_affecting_substance = COALESCE($6, schedules.heart_rate_affecting_substance), updated_at = now()
         RETURNING *`,
        [
          uid,
          s.morning_time,
          s.evening_time,
          s.timezone,
          s.reminders_enabled,
          s.heart_rate_affecting_substance ?? null,
        ],
      );
      await c.query('UPDATE users SET timezone = $2 WHERE id = $1', [uid, s.timezone]);
      await audit(c, uid, 'schedule.changed', {});
      return rows[0];
    });
    return scheduleOut(row);
  });

  // ── export ──
  /** Expired exports keep no copy of anyone's data. */
  const purgeExpiredExports = () =>
    app.db.query(
      "UPDATE export_jobs SET payload = NULL, status = 'expired' WHERE expires_at < now() AND payload IS NOT NULL",
    );

  app.post('/export', async (req, reply) => {
    const uid = req.userId!;
    await purgeExpiredExports();
    const key = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100) ?? null;
    if (key) {
      const { rows } = await app.db.query(
        'SELECT id, status, created_at, expires_at FROM export_jobs WHERE user_id = $1 AND idempotency_key = $2',
        [uid, key],
      );
      if (rows.length) return reply.status(202).send(rows[0]);
    }
    await audit(app.db, uid, 'export.requested');
    const payload = await collectExport(app.db, uid);
    const { rows } = await app.db.query(
      `INSERT INTO export_jobs (user_id, status, idempotency_key, payload, completed_at, expires_at)
       VALUES ($1, 'completed', $2, $3, now(), now() + interval '24 hours') RETURNING id, status, created_at, expires_at`,
      [uid, key, JSON.stringify(payload)],
    );
    await audit(app.db, uid, 'export.completed', { job_id: rows[0].id });
    return reply.status(202).send(rows[0]);
  });

  app.get('/export/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { rows } = await app.db.query(
      `SELECT id, CASE WHEN expires_at < now() THEN 'expired' ELSE status END AS status, created_at, completed_at, expires_at
         FROM export_jobs WHERE id = $1 AND user_id = $2`,
      [id, req.userId],
    );
    if (!rows.length) throw notFound('Export');
    return rows[0];
  });

  app.get('/export/:id/download', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { rows } = await app.db.query(
      "SELECT payload FROM export_jobs WHERE id = $1 AND user_id = $2 AND status = 'completed' AND expires_at > now()",
      [id, req.userId],
    );
    if (!rows.length) throw notFound('Export');
    reply.header('content-disposition', `attachment; filename="edgevitals-export-${id}.json"`);
    reply.header('cache-control', 'no-store');
    return rows[0].payload;
  });

  // ── deletion ──
  app.post('/deletion-request', async (req, reply) => {
    const body = parse(
      z.object({ confirm: z.literal('DELETE'), password: z.string().min(1).max(200) }),
      req.body,
    );
    const uid = req.userId!;
    // Re-authenticate: a stolen access token alone must not be able to erase an account.
    const { rows: u } = await app.db.query('SELECT password_hash FROM users WHERE id = $1', [uid]);
    if (!u.length || !(await verifyPassword(u[0].password_hash, body.password)))
      // 403, not 401: the session is fine, so the app must not sign the person out.
      throw forbidden('password_incorrect', 'Password is incorrect');
    const job = await withTransaction(app.db, async (c) => {
      const { rows } = await c.query(
        "INSERT INTO deletion_jobs (user_id, status) VALUES ($1, 'pending') RETURNING id",
        [uid],
      );
      await audit(c, uid, 'deletion.requested', { job_id: rows[0].id });
      // Cascades to profile, consents, schedule, tokens, assessments, check-ins, measurements, cuff readings, exports.
      const del = await c.query('DELETE FROM users WHERE id = $1', [uid]);
      if (del.rowCount !== 1) throw new ApiError(500, 'deletion_failed', 'Deletion failed');
      await c.query(
        "UPDATE deletion_jobs SET status = 'completed', completed_at = now() WHERE id = $1",
        [rows[0].id],
      );
      await audit(c, uid, 'deletion.completed', { job_id: rows[0].id });
      return rows[0].id as string;
    });
    return reply.status(202).send({
      id: job,
      status: 'completed',
      deleted: [
        'account',
        'profile',
        'consents',
        'schedule',
        'sessions',
        'assessments',
        'check-ins',
        'measurements',
        'cuff blood-pressure readings',
        'exports',
      ],
      retained:
        'An audit record that a deletion happened (no health data). Encrypted database backups expire on the documented backup schedule.',
    });
  });

  app.get('/deletion-request/:id', { config: { public: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { rows } = await app.db.query(
      'SELECT id, status, requested_at, completed_at FROM deletion_jobs WHERE id = $1',
      [id],
    );
    if (!rows.length) throw notFound('Deletion request');
    return rows[0];
  });
}
