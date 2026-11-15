import { BadRequestException } from '@nestjs/common';

/**
 * Opaque page cursor. Today it wraps the serial id; clients must not parse it,
 * so it can later become (createdAt, id) without an API change.
 */
export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): number {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    const id = (parsed as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id;
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}
