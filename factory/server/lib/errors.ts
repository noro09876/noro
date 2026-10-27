/** Errors with a stable code and a user-facing Russian message. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Объект') => new AppError(404, 'not_found', `${what} не найден`);
export const forbidden = (msg = 'Недостаточно прав') => new AppError(403, 'forbidden', msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);

/**
 * Error raised by providers and platform adapters. `retryable` drives the job queue:
 * rate limits and network failures retry with backoff, auth/permission errors don't.
 */
export class ExternalError extends Error {
  constructor(
    public service: string,
    public code: string,
    message: string,
    public retryable: boolean,
    public retryAfterSec?: number,
    public httpStatus?: number,
  ) {
    super(message);
  }
}
