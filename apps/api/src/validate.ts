import type { z } from 'zod';
import { ApiError } from './errors';

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    // 400 when the shape is wrong, 422 when well-formed but semantically invalid.
    const shape = r.error.issues.some(
      (i) => i.code === 'invalid_type' || i.code === 'unrecognized_keys',
    );
    throw new ApiError(
      shape ? 400 : 422,
      shape ? 'malformed_request' : 'validation_failed',
      'Request validation failed',
      issues,
    );
  }
  return r.data;
}
