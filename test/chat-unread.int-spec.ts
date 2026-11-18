/** FEAT-08a: chat unread counts, mark-read and the `chat` SSE event. */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication, MessageEvent } from '@nestjs/common';
import request from 'supertest';
import { Subscription } from 'rxjs';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import { addMember, createProject, sendMessage } from './chat-fixtures';
import { API_CONTRACT } from '../src/common/api-contract';
import { NotificationsService } from '../src/notifications/notifications.service';

const q = <T = any>(sql: string, params: unknown[] = []) =>
  queryDb<T>(BASE_URL, API_TEST_DB, sql, params);
const F = API_CONTRACT.chat.fields;
const keys = (o: object) => Object.keys(o).sort();
const sorted = (a: readonly string[]) => [...a].sort();
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('chat unread (FEAT-08a)', () => {
  let app: INestApplication;
  let O: TestUser; // owner
  let M: TestUser; // member
  let X: TestUser; // second member
  let S: TestUser; // stranger
  let P: string;
  const server = () => app.getHttpServer();
  const unread = async (u: TestUser) => {
    const res = await request(server()).get('/api/chat/unread').set(bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    return res.body.data as {
      items: { project_id: string; unread_count: number }[];
      total: number;
    };
  };
  const countIn = async (u: TestUser, project: string) =>
    (await unread(u)).items.find((i) => i.project_id === project)
      ?.unread_count ?? 0;
  const markRead = (u: TestUser, project: string, message_id: unknown) =>
    request(server())
      .put(`/api/chat/projects/${project}/read`)
      .set(bearer(u))
      .send({ message_id });
  const send = async (u: TestUser, project: string, body: string) => {
    await tick(); // distinct created_at per message
    const res = await sendMessage(app, u, project, body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string; created_at: string };
  };
  const deleteMessage = (u: TestUser, project: string, id: string) =>
    request(server())
      .delete(`/api/chat/projects/${project}/messages/${id}`)
      .set(bearer(u));
  const removeMember = (u: TestUser, project: string, userId: string) =>
    request(server())
      .delete(`/api/chat/projects/${project}/members/${userId}`)
      .set(bearer(u));

  beforeAll(async () => {
    app = await createTestApp();
    O = await signupAndLogin(app, 'uowner');
    M = await signupAndLogin(app, 'umember');
    X = await signupAndLogin(app, 'uxtra');
    S = await signupAndLogin(app, 'ustranger');
    P = await createProject(app, O, 'Unread');
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('U1: both routes need a token', async () => {
    const get = await request(server()).get('/api/chat/unread');
    const put = await request(server())
      .put(`/api/chat/projects/${P}/read`)
      .send({ message_id: '0b7b4d4e-3c1a-4f7e-9d2a-6b1e2f3a4b5c' });
    for (const res of [get, put]) {
      expect([res.status, res.body.code]).toEqual([401, 'TOKEN_MISSING']);
    }
  });

  it("U2: history from before a member joined and the owner's own messages don't count", async () => {
    await send(O, P, 'before M joined 1');
    await send(O, P, 'before M joined 2');
    await tick();
    expect((await addMember(app, O, P, M.username)).status).toBe(201);
    expect(await unread(M)).toEqual({ items: [], total: 0 });
    expect(await unread(O)).toEqual({ items: [], total: 0 });
  });

  it('U3: new messages from others count; the shape matches the contract', async () => {
    await send(M, P, 'from M 1');
    await send(M, P, 'from M 2');
    const data = await unread(O);
    expect(keys(data)).toEqual(sorted(F.unread));
    expect(data).toEqual({
      items: [{ project_id: P, unread_count: 2 }],
      total: 2,
    });
    expect(keys(data.items[0])).toEqual(sorted(F.unreadItem));
    expect(await unread(M)).toEqual({ items: [], total: 0 }); // own messages
  });

  it("U4: deleted messages don't count", async () => {
    const third = await send(M, P, 'from M 3');
    expect(await countIn(O, P)).toBe(3);
    expect((await deleteMessage(M, P, third.id)).status).toBe(200);
    expect(await countIn(O, P)).toBe(2);
  });

  it('U5: mark-read moves the point forward and never back; idempotent', async () => {
    const older = await send(M, P, 'older');
    const newer = await send(M, P, 'newer');
    expect(await countIn(O, P)).toBe(4);

    const first = await markRead(O, P, newer.id);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('success');
    expect(keys(first.body.data)).toEqual(sorted(F.readPoint));
    expect(first.body.data).toEqual({
      project_id: P,
      last_read_at: newer.created_at,
    });
    expect(await unread(O)).toEqual({ items: [], total: 0 });

    const back = await markRead(O, P, older.id);
    expect(back.status).toBe(200);
    expect(back.body.data.last_read_at).toBe(newer.created_at);
    const again = await markRead(O, P, newer.id);
    expect(again.body.data.last_read_at).toBe(newer.created_at);
    expect(await countIn(O, P)).toBe(0);

    // Only newer messages count again.
    await send(M, P, 'after read');
    expect(await countIn(O, P)).toBe(1);
  });

  it('U6: a deleted message can be marked read', async () => {
    const gone = await send(M, P, 'to be deleted');
    expect((await deleteMessage(M, P, gone.id)).status).toBe(200);
    const res = await markRead(O, P, gone.id);
    expect(res.status).toBe(200);
    expect(res.body.data.last_read_at).toBe(gone.created_at);
    expect(await countIn(O, P)).toBe(0);
  });

  it("U7: 404 for a stranger, another project's message and an unknown id; 400 for a bad id", async () => {
    const P2 = await createProject(app, O, 'Other');
    const elsewhere = await send(O, P2, 'in P2');
    const res = await markRead(M, P, elsewhere.id);
    expect([res.status, res.body.message]).toEqual([404, 'Message not found']);
    const unknown = await markRead(
      O,
      P,
      '0b7b4d4e-3c1a-4f7e-9d2a-6b1e2f3a4b5c',
    );
    expect(unknown.status).toBe(404);

    const latest = await send(M, P, 'for the stranger');
    for (const project of [P, 'PRJ-000000000']) {
      const s = await markRead(S, project, latest.id);
      expect([s.status, s.body.message]).toEqual([404, 'Project not found']);
    }
    expect(await unread(S)).toEqual({ items: [], total: 0 });

    for (const bad of [undefined, '', 'nope', 7]) {
      expect((await markRead(O, P, bad)).status).toBe(400);
    }
    expect(
      await q('SELECT 1 FROM chat_reads WHERE user_id = $1', [S.user_id]),
    ).toHaveLength(0);
  });

  it('U8: removing a member deletes their read row; re-adding starts from the new join time', async () => {
    const msg = await send(O, P, 'for M');
    expect((await markRead(M, P, msg.id)).status).toBe(200);
    const rows = () =>
      q('SELECT 1 FROM chat_reads WHERE project_id = $1 AND user_id = $2', [
        P,
        M.user_id,
      ]);
    expect(await rows()).toHaveLength(1);

    expect((await removeMember(O, P, M.user_id)).status).toBe(200);
    expect(await rows()).toHaveLength(0);
    expect(await countIn(M, P)).toBe(0);

    await send(O, P, 'while M was away');
    await tick();
    expect((await addMember(app, O, P, M.username)).status).toBe(201);
    expect(await countIn(M, P)).toBe(0);
    await send(O, P, 'welcome back');
    expect(await countIn(M, P)).toBe(1);
  });

  it('U9: a soft-deleted project disappears from items', async () => {
    const P3 = await createProject(app, O, 'Doomed');
    expect((await addMember(app, O, P3, M.username)).status).toBe(201);
    await send(M, P3, 'hello');
    expect(await countIn(O, P3)).toBe(1);
    const del = await request(server())
      .delete(`/api/projects/${P3}`)
      .set(bearer(O));
    expect(del.status).toBeLessThan(300);
    expect((await unread(O)).items.map((i) => i.project_id)).not.toContain(P3);
    expect((await unread(M)).items.map((i) => i.project_id)).not.toContain(P3);
  });

  it('U10: each count is capped; total is the sum of the capped counts', async () => {
    const P4 = await createProject(app, O, 'Busy');
    expect((await addMember(app, O, P4, M.username)).status).toBe(201);
    await q(
      `INSERT INTO chat_messages (id, project_id, user_id, body, created_at)
       SELECT gen_random_uuid(), $1, $2, 'm' || g,
              now() + g * interval '1 millisecond'
         FROM generate_series(1, 150) g`,
      [P4, M.user_id],
    );
    const data = await unread(O);
    const cap = API_CONTRACT.chat.unreadCap;
    expect(cap).toBe(100);
    expect(data.items.find((i) => i.project_id === P4)?.unread_count).toBe(cap);
    expect(data.total).toBe(
      data.items.reduce((sum, i) => sum + i.unread_count, 0),
    );
  });

  describe('SSE `chat` events', () => {
    let SP: string;
    const seen = new Map<string, MessageEvent[]>();
    const subs: Subscription[] = [];
    const chatEvents = (u: TestUser) =>
      (seen.get(u.user_id) ?? []).filter(
        (e) => e.type === API_CONTRACT.chat.sseEventType,
      );
    const settle = () => new Promise((r) => setTimeout(r, 100));

    beforeAll(async () => {
      SP = await createProject(app, O, 'Live');
      expect((await addMember(app, O, SP, M.username)).status).toBe(201);
      expect((await addMember(app, O, SP, X.username)).status).toBe(201);
      const notifications = app.get(NotificationsService);
      for (const u of [O, M, X, S]) {
        seen.set(u.user_id, []);
        subs.push(
          notifications
            .getNotificationStream(u.user_id)
            .subscribe((e) => seen.get(u.user_id)!.push(e)),
        );
      }
    });
    afterAll(() => subs.forEach((s) => s.unsubscribe()));
    beforeEach(() => {
      for (const list of seen.values()) list.length = 0;
    });

    it('E1: a new message sends one event to each recipient and none to the author', async () => {
      await send(M, SP, 'live one');
      await settle();
      for (const u of [O, X]) {
        expect(chatEvents(u)).toEqual([
          { type: 'chat', data: JSON.stringify({ project_id: SP }) },
        ]);
        expect(keys(JSON.parse(chatEvents(u)[0].data as string))).toEqual(
          sorted(F.unreadEvent),
        );
      }
      expect(chatEvents(M)).toEqual([]);
      expect(chatEvents(S)).toEqual([]);
    });

    it('E2: a delete notifies everyone but the actor', async () => {
      const msg = await send(M, SP, 'to delete');
      await settle();
      for (const list of seen.values()) list.length = 0;
      expect((await deleteMessage(O, SP, msg.id)).status).toBe(200);
      await settle();
      expect(chatEvents(M)).toHaveLength(1);
      expect(chatEvents(X)).toHaveLength(1);
      expect(chatEvents(O)).toEqual([]);
    });

    it('E3: mark-read notifies only the reader', async () => {
      const msg = await send(M, SP, 'read me');
      await settle();
      for (const list of seen.values()) list.length = 0;
      expect((await markRead(X, SP, msg.id)).status).toBe(200);
      await settle();
      expect(chatEvents(X)).toHaveLength(1);
      expect([...chatEvents(O), ...chatEvents(M)]).toEqual([]);
    });

    it('E4: removing a member notifies the removed user', async () => {
      expect((await removeMember(O, SP, X.user_id)).status).toBe(200);
      await settle();
      expect(chatEvents(X)).toEqual([
        { type: 'chat', data: JSON.stringify({ project_id: SP }) },
      ]);
      expect([...chatEvents(O), ...chatEvents(M)]).toEqual([]);
    });

    it('E5: chat events carry no id, so Last-Event-ID stays on notifications', () => {
      // E1-E4 asserted the whole event object: { type, data } and nothing else.
      expect(API_CONTRACT.chat.sseEventType).toBe('chat');
    });
  });
});
