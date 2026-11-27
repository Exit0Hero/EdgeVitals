import type { AssessmentRecord } from '@edgevitals/domain';
import type { Queryable } from './db';

/** Load a user's terminal assessments in the analytics input shape. */
export async function loadRecords(
  db: Queryable,
  userId: string,
  sinceDays = 400,
): Promise<AssessmentRecord[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.status, a.started_at, a.timezone, a.demo,
            c.kind AS ci_kind, c.sleep_quality, c.energy_rating, c.stress_rating, c.alcohol_previous_evening,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('metric', m.metric, 'status', m.status, 'value', m.value_numeric,
                                                   'valueSecondary', m.value_secondary, 'method', m.method, 'algorithm', m.algorithm_name))
                        FROM measurements m WHERE m.assessment_id = a.id), '[]') AS measurements
       FROM assessments a LEFT JOIN check_ins c ON c.assessment_id = a.id
      WHERE a.user_id = $1 AND a.status IN ('completed', 'partial', 'failed', 'cancelled')
        AND a.started_at > now() - ($2::int * interval '1 day')
      ORDER BY a.started_at`,
    [userId, sinceDays],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    startedAt: new Date(r.started_at).toISOString(),
    timezone: r.timezone,
    demo: r.demo,
    checkIn:
      r.ci_kind === 'morning'
        ? {
            kind: 'morning',
            sleep_quality: r.sleep_quality,
            energy_rating: r.energy_rating,
            alcohol_previous_evening: r.alcohol_previous_evening,
          }
        : r.ci_kind === 'evening'
          ? { kind: 'evening', stress_rating: r.stress_rating, energy_rating: r.energy_rating }
          : null,
    measurements: r.measurements,
  }));
}

export async function userTimezone(db: Queryable, userId: string): Promise<string> {
  const { rows } = await db.query(
    "SELECT COALESCE(s.timezone, u.timezone, 'UTC') AS tz FROM users u LEFT JOIN schedules s ON s.user_id = u.id WHERE u.id = $1",
    [userId],
  );
  return rows[0]?.tz ?? 'UTC';
}
