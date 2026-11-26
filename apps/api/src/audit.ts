import type { Queryable } from './db';

/**
 * Append an audit event. `details` must never contain credentials, raw
 * biometric streams, images or free-text health data.
 */
export async function audit(
  db: Queryable,
  userId: string | null,
  eventType: string,
  details: Record<string, unknown> = {},
) {
  await db.query('INSERT INTO audit_events (user_id, event_type, details) VALUES ($1, $2, $3)', [
    userId,
    eventType,
    JSON.stringify(details),
  ]);
}
