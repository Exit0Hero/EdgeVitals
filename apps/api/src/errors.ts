export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthenticated', message);
