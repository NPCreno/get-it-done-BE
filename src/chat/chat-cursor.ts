import { BadRequestException } from '@nestjs/common';

export interface MessageCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opaque page cursor for chat messages: the (created_at, id) of the last item
 * of a page. Clients must not parse it. created_at has millisecond precision
 * in the database, so the ISO string round-trips exactly.
 */
export function encodeMessageCursor(c: MessageCursor): string {
  return Buffer.from(
    JSON.stringify({ t: c.createdAt.toISOString(), id: c.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeMessageCursor(cursor: string): MessageCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { t?: unknown; id?: unknown } | null;
    const t = parsed?.t;
    const id = parsed?.id;
    if (typeof t === 'string' && typeof id === 'string' && UUID.test(id)) {
      const createdAt = new Date(t);
      if (!Number.isNaN(createdAt.getTime()) && createdAt.toISOString() === t) {
        return { createdAt, id: id.toLowerCase() };
      }
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}
