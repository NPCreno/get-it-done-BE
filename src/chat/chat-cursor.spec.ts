import { BadRequestException } from '@nestjs/common';
import { decodeMessageCursor, encodeMessageCursor } from './chat-cursor';

const ID = '3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

describe('chat message cursor (U-chat-3)', () => {
  it('round-trips (created_at, id) exactly, to the millisecond', () => {
    const createdAt = new Date('2026-11-17T10:20:30.123Z');
    const c = encodeMessageCursor({ createdAt, id: ID });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMessageCursor(c)).toEqual({ createdAt, id: ID });
  });

  it('is opaque: not the raw id or timestamp', () => {
    const c = encodeMessageCursor({ createdAt: new Date(0), id: ID });
    expect(c).not.toContain(ID);
  });

  it('rejects anything malformed with 400', () => {
    for (const bad of [
      '',
      '!!!',
      'e30', // {}
      b64({ t: '2026-11-17T10:20:30.123Z' }),
      b64({ t: '2026-11-17T10:20:30.123Z', id: 'not-a-uuid' }),
      b64({ t: 'yesterday', id: ID }),
      b64({ t: '2026-11-17', id: ID }), // not the canonical ISO form
      b64({ t: 5, id: ID }),
      b64(null),
      b64([1, 2]),
    ]) {
      expect(() => decodeMessageCursor(bad)).toThrow(BadRequestException);
    }
  });
});
