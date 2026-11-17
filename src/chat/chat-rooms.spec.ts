import { ChatRoomsService, RoomClient } from './chat-rooms.service';
import { isAllowedOrigin } from './ws-origin';

const client = (userId: string) => {
  const sent: unknown[] = [];
  const c: RoomClient & { sent: unknown[] } = {
    userId,
    sent,
    send: (t: string) => sent.push(JSON.parse(t)),
  };
  return c;
};

describe('ChatRoomsService (U-chat-6)', () => {
  it('broadcasts {type, data} only to the room', () => {
    const rooms = new ChatRoomsService();
    const a = client('a');
    const b = client('b');
    rooms.join('P1', a);
    rooms.join('P2', b);
    rooms.broadcast('P1', 'message.deleted', { id: 'x', project_id: 'P1' });
    expect(a.sent).toEqual([
      { type: 'message.deleted', data: { id: 'x', project_id: 'P1' } },
    ]);
    expect(b.sent).toEqual([]);
  });

  it("kick removes only that user's sockets and tells them", () => {
    const rooms = new ChatRoomsService();
    const a1 = client('a');
    const a2 = client('a');
    const b = client('b');
    for (const c of [a1, a2, b]) rooms.join('P1', c);
    rooms.kick('P1', 'a');
    expect(rooms.size('P1')).toBe(1);
    expect(rooms.isIn('P1', b)).toBe(true);
    expect(a1.sent).toEqual([{ type: 'removed', data: { project_id: 'P1' } }]);
    rooms.broadcast('P1', 'message.created', {});
    expect(a2.sent).toHaveLength(1);
  });

  it('caps rooms per socket and cleans up on leaveAll', () => {
    const rooms = new ChatRoomsService();
    const a = client('a');
    for (let i = 0; i < 50; i++) expect(rooms.join(`P${i}`, a)).toBe(true);
    expect(rooms.join('P50', a)).toBe(false);
    expect(rooms.join('P0', a)).toBe(true); // already in it
    rooms.leaveAll(a);
    expect(rooms.size('P0')).toBe(0);
    expect(rooms.join('P50', a)).toBe(true);
  });
});

describe('isAllowedOrigin (U-chat-7)', () => {
  const fe = 'https://app.example.com';
  it('accepts exactly the frontend origin', () => {
    expect(isAllowedOrigin('https://app.example.com', fe)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com/', `${fe}/`)).toBe(true);
  });
  it('refuses anything else', () => {
    for (const o of [
      undefined,
      '',
      'null',
      'http://app.example.com',
      'https://app.example.com:8443',
      'https://evil.example.com',
      'https://app.example.com.evil.io',
    ]) {
      expect([o, isAllowedOrigin(o, fe)]).toEqual([o, false]);
    }
  });
});
