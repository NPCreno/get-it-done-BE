import { HttpException } from '@nestjs/common';

export const GENERIC_ERROR = 'Something went wrong';
export const NOT_ALLOWED = 'Not allowed';
/** 404 messages that are safe to show as they are. */
const SAFE_NOT_FOUND =
  /^(Task|Subtask|Project|Notification|Message) not found$/;

/** A failure envelope from a service ({ status: 'error' }) that was not expected. */
export class ServiceFailure extends Error {
  constructor(public readonly detail: unknown) {
    super('service returned an error envelope');
    this.name = 'ServiceFailure';
  }
}

/** Throws ServiceFailure unless the service answered `status: 'success'`. */
export function unwrap<T extends { status: string }>(result: T): T {
  if (result.status !== 'success') throw new ServiceFailure(result);
  return result;
}

/**
 * The text a tool error shows the client. Nest 404s keep a safe label (missing
 * and someone else's are the same answer), 401/403 are "Not allowed", 400s
 * pass their validation message through, and anything else is generic: the
 * caller logs the full error, the client never sees it.
 */
export function toolErrorMessage(err: unknown): {
  message: string;
  expected: boolean;
} {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status === 404) {
      const m = err.message;
      return {
        message: SAFE_NOT_FOUND.test(m) ? m : 'Not found',
        expected: true,
      };
    }
    if (status === 401 || status === 403)
      return { message: NOT_ALLOWED, expected: true };
    if (status === 400) {
      const body = err.getResponse();
      const msg =
        typeof body === 'object' && body !== null && 'message' in body
          ? body.message
          : err.message;
      const text = Array.isArray(msg)
        ? msg.map(String).join('; ')
        : String(msg);
      return { message: text, expected: true };
    }
  }
  return { message: GENERIC_ERROR, expected: false };
}
