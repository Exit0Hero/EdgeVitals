import { cuffReadingSchema } from '@edgevitals/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import { forbidden, notFound } from '../errors';
import { parse } from '../validate';
import { consentState } from './me';

const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({ days: z.coerce.number().int().min(1).max(400).default(90) });

const COLUMNS = 'id, systolic, diastolic, pulse_bpm, measured_at, created_at';

/** Blood pressure typed in from the user's own cuff. Self-reported, never a camera reading. */
export async function cuffReadingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    await app.authenticate(req);
  });

  app.get('/', async (req) => {
    const { days } = parse(listQuery, req.query);
    const { rows } = await app.db.query(
      `SELECT ${COLUMNS} FROM cuff_bp_readings
        WHERE user_id = $1 AND measured_at > now() - ($2::int * interval '1 day')
        ORDER BY measured_at DESC LIMIT 200`,
      [req.userId!, days],
    );
    return { items: rows };
  });

  app.post('/', async (req, reply) => {
    const uid = req.userId!;
    const body = parse(cuffReadingSchema, req.body);
    if (!(await consentState(app.db, uid)).requiredGranted)
      throw forbidden('consent_required', 'Required consent must be granted first');
    const { rows } = await app.db.query(
      `INSERT INTO cuff_bp_readings (user_id, systolic, diastolic, pulse_bpm, measured_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [uid, body.systolic, body.diastolic, body.pulse_bpm ?? null, body.measured_at],
    );
    await audit(app.db, uid, 'cuff_reading.created', { id: rows[0].id });
    return reply.status(201).send(rows[0]);
  });

  app.delete('/:id', async (req, reply) => {
    const uid = req.userId!;
    const { id } = parse(idParam, req.params);
    const del = await app.db.query('DELETE FROM cuff_bp_readings WHERE id = $1 AND user_id = $2', [
      id,
      uid,
    ]);
    if (del.rowCount !== 1) throw notFound('Reading');
    await audit(app.db, uid, 'cuff_reading.deleted', { id });
    return reply.status(204).send();
  });
}
