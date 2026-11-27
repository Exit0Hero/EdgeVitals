import {
  HEALTH_SYNC_METRICS,
  HEALTH_SYNC_PLATFORMS,
  healthSyncUploadSchema,
} from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import { forbidden } from '../errors';
import { parse } from '../validate';
import { consentState } from './me';

const listQuery = z.object({
  days: z.coerce.number().int().min(1).max(400).default(90),
  metric: z.enum(HEALTH_SYNC_METRICS).optional(),
});
const deleteQuery = z.object({ platform: z.enum(HEALTH_SYNC_PLATFORMS).optional() });

export const HEALTH_SYNC_COLUMNS = `id, platform, metric, value::float8 AS value, value_secondary, measured_at,
  source_app, source_name, device_manufacturer, device_model, created_at`;

/**
 * SpO2 and blood pressure read from Health Connect / Apple Health (ADR 0009).
 * The phone reads them (read-only) and uploads copies here, tagged with the
 * app and device that recorded them. They are never camera readings and never
 * feed baselines or scores.
 */
export async function healthSyncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    await app.authenticate(req);
  });

  app.get('/readings', async (req) => {
    const { days, metric } = parse(listQuery, req.query);
    const { rows } = await app.db.query(
      `SELECT ${HEALTH_SYNC_COLUMNS} FROM health_sync_readings
        WHERE user_id = $1 AND measured_at > now() - ($2::int * interval '1 day')
          AND ($3::text IS NULL OR metric = $3)
        ORDER BY measured_at DESC LIMIT 300`,
      [req.userId!, days, metric ?? null],
    );
    return { items: rows };
  });

  /** Idempotent: re-sending the same health-store records updates them in place. */
  app.post('/readings', async (req) => {
    const uid = req.userId!;
    const body = parse(healthSyncUploadSchema, req.body);
    const consent = await consentState(app.db, uid);
    if (!consent.requiredGranted)
      throw forbidden('consent_required', 'Required consent must be granted first');
    if (!consent.state.health_sync.active)
      throw forbidden('health_sync_consent_required', 'Health app sync is turned off');
    if (!body.readings.length) return { received: 0, inserted: 0, updated: 0 };
    const { rows } = await app.db.query(
      `INSERT INTO health_sync_readings AS h
         (user_id, platform, metric, value, value_secondary, measured_at, external_id,
          source_app, source_name, device_manufacturer, device_model)
       SELECT $1, $2, r.metric, r.value, r.value_secondary, r.measured_at, r.external_id,
              r.source_app, r.source_name, r.device_manufacturer, r.device_model
         FROM jsonb_to_recordset($3::jsonb) AS r(
           metric text, value numeric, value_secondary smallint, measured_at timestamptz,
           external_id text, source_app text, source_name text,
           device_manufacturer text, device_model text)
       ON CONFLICT (user_id, platform, external_id) DO UPDATE SET
         metric = EXCLUDED.metric, value = EXCLUDED.value, value_secondary = EXCLUDED.value_secondary,
         measured_at = EXCLUDED.measured_at, source_app = EXCLUDED.source_app,
         source_name = EXCLUDED.source_name, device_manufacturer = EXCLUDED.device_manufacturer,
         device_model = EXCLUDED.device_model, updated_at = now()
       WHERE (h.metric, h.value, h.value_secondary, h.measured_at, h.source_app, h.source_name,
              h.device_manufacturer, h.device_model)
         IS DISTINCT FROM
             (EXCLUDED.metric, EXCLUDED.value, EXCLUDED.value_secondary, EXCLUDED.measured_at,
              EXCLUDED.source_app, EXCLUDED.source_name, EXCLUDED.device_manufacturer,
              EXCLUDED.device_model)
       RETURNING (xmax = 0) AS inserted`,
      [
        uid,
        body.platform,
        JSON.stringify(
          // Last copy wins if the phone sent the same record twice in one batch.
          [...new Map(body.readings.map((r) => [r.external_id, r])).values()].map((r) => ({
            ...r,
            value_secondary: r.value_secondary ?? null,
            source_name: r.source_name ?? null,
            device_manufacturer: r.device_manufacturer ?? null,
            device_model: r.device_model ?? null,
          })),
        ),
      ],
    );
    const inserted = rows.filter((r) => r.inserted).length;
    const updated = rows.length - inserted;
    if (rows.length)
      await audit(app.db, uid, 'health_sync.imported', {
        platform: body.platform,
        inserted,
        updated,
      });
    return { received: body.readings.length, inserted, updated };
  });

  /** Delete every synced copy (optionally for one platform). The phone's health store is untouched. */
  app.delete('/readings', async (req) => {
    const uid = req.userId!;
    const { platform } = parse(deleteQuery, req.query);
    const del = await app.db.query(
      'DELETE FROM health_sync_readings WHERE user_id = $1 AND ($2::text IS NULL OR platform = $2)',
      [uid, platform ?? null],
    );
    await audit(app.db, uid, 'health_sync.deleted', {
      platform: platform ?? 'all',
      count: del.rowCount ?? 0,
    });
    return { deleted: del.rowCount ?? 0 };
  });
}
