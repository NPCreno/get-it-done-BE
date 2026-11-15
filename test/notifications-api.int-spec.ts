/** RT-01: list, read state, and the typed stream. */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import http from 'http';
import { AddressInfo } from 'net';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);
const settle = () => new Promise((r) => setTimeout(r, 800));

describe('notifications API (RT-01)', () => {
  let app: INestApplication;
  let A: TestUser;
  let B: TestUser;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    A = await signupAndLogin(app, 'a');
    B = await signupAndLogin(app, 'b');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const complete = async (u: TestUser, title = 'Task one') => {
    const t = await request(server())
      .post('/api/tasks/create')
      .set(bearer(u))
      .send({ title, priority: 'Low', status: 'Pending', isRecurring: false });
    const id = t.body.data.task_id as string;
    await request(server())
      .patch(`/api/tasks/update-task-status/${id}/status/Complete`)
      .set(bearer(u));
    await settle();
  };
  const list = (u: TestUser, qs = '') =>
    request(server()).get(`/api/notifications${qs}`).set(bearer(u));

  it('N1/N6: newest first, scoped to the caller, exact item fields', async () => {
    await complete(A);
    const res = await list(A);
    expect(res.status).toBe(200);
    const { items, unread_count } = res.body.data;
    expect(items.length).toBeGreaterThan(0);
    expect(unread_count).toBe(items.length);
    const ids = (
      await q(
        'SELECT id FROM notifications WHERE user_id = $1 ORDER BY id DESC',
        [A.user_id],
      )
    ).map((r) => r.id);
    expect(ids).toHaveLength(items.length);
    expect(Object.keys(items[0]).sort()).toEqual([
      'actionType',
      'createdAt',
      'message',
      'notif_id',
      'read',
      'title',
      'type',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(
      /metadata|actionTarget|user_id/,
    );
    expect((await list(B)).body.data.items).toEqual([]);
  });

  it('N2: pagination with an opaque cursor', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    await q(
      `INSERT INTO notifications (notif_id, user_id, type, title, message, read, "createdAt", "updatedAt")
       SELECT 'page-' || g, $1, 'achievement', 't', 'm', false, now(), now() FROM generate_series(1, ${rows.length}) g`,
      [B.user_id],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await list(
        B,
        `?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      sizes.push(res.body.data.items.length);
      seen.push(
        ...res.body.data.items.map((i: { notif_id: string }) => i.notif_id),
      );
      cursor = res.body.data.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    for (const bad of [
      'limit=0',
      'limit=101',
      'limit=abc',
      'cursor=!!!',
      'cursor=e30',
    ]) {
      expect([bad, (await list(B, `?${bad}`)).status]).toEqual([bad, 400]);
    }
  });

  it('N3: mark read is idempotent and lowers unread once', async () => {
    const before = (await list(A)).body.data;
    const id = before.items[0].notif_id;
    for (let i = 0; i < 2; i++) {
      const r = await request(server())
        .patch(`/api/notifications/${id}/read`)
        .set(bearer(A));
      expect(r.status).toBe(200);
    }
    const after = (await list(A)).body.data;
    expect(after.unread_count).toBe(before.unread_count - 1);
    expect(
      after.items.find((i: { notif_id: string }) => i.notif_id === id).read,
    ).toBe(true);
  });

  it('N4: another user or an unknown id is the same 404, row unchanged', async () => {
    const id =
      (await list(A)).body.data.items[1]?.notif_id ??
      (await list(A)).body.data.items[0].notif_id;
    const mine = (
      await q('SELECT read FROM notifications WHERE notif_id = $1', [id])
    )[0].read;
    const other = await request(server())
      .patch(`/api/notifications/${id}/read`)
      .set(bearer(B));
    const unknown = await request(server())
      .patch('/api/notifications/notif-000000000/read')
      .set(bearer(B));
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(other.body.message).toBe(unknown.body.message);
    expect(
      (await q('SELECT read FROM notifications WHERE notif_id = $1', [id]))[0]
        .read,
    ).toBe(mine);
  });

  it("N5: read-all marks only the caller's rows", async () => {
    const bUnread = (await list(B)).body.data.unread_count;
    const res = await request(server())
      .patch('/api/notifications/read-all')
      .set(bearer(A));
    expect(res.status).toBe(200);
    expect((await list(A)).body.data.unread_count).toBe(0);
    expect((await list(B)).body.data.unread_count).toBe(bUnread);
    const again = await request(server())
      .patch('/api/notifications/read-all')
      .set(bearer(A));
    expect(again.body.data.updated).toBe(0);
  });

  function openStream(port: number, token: string) {
    return new Promise<{
      status: number;
      chunks: string[];
      ended: () => boolean;
      close: () => void;
    }>((resolve, reject) => {
      const chunks: string[] = [];
      let ended = false;
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/notifications/sse',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => (ended = true));
          res.on('close', () => (ended = true));
          resolve({
            status: res.statusCode ?? 0,
            chunks,
            ended: () => ended,
            close: () => req.destroy(),
          });
        },
      );
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
      });
    });
  }

  it('N7: the stream frame carries event, id and the item fields', async () => {
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const C = await signupAndLogin(app, 'stream');
    const s = await openStream(port, C.access);
    expect(s.status).toBe(200);
    await complete(C);
    const text = s.chunks.join('');
    s.close();
    expect(text).toMatch(/event: notification/);
    expect(text).toMatch(/id: notif-\d+/);
    const data = JSON.parse(/data: (\{.*\})/.exec(text)![1]);
    expect(Object.keys(data).sort()).toEqual([
      'actionType',
      'createdAt',
      'message',
      'notif_id',
      'read',
      'title',
      'type',
    ]);
    expect(data.read).toBe(false);
  });

  it('N9: the stream ends at the token expiry', async () => {
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const jwt = app.get(JwtService);
    const short = jwt.sign(
      {
        sub: A.user_id,
        type: 'access',
        user: { user_id: A.user_id, role: 'user' },
      },
      { expiresIn: 2 },
    );
    const s = await openStream(port, short);
    expect(s.status).toBe(200);
    await new Promise((r) => setTimeout(r, 3500));
    expect(s.ended()).toBe(true);
  });

  it('N10: clear empties the list and does not re-award', async () => {
    await request(server())
      .delete(`/api/notifications/clear/${A.user_id}`)
      .set(bearer(A));
    expect((await list(A)).body.data.items).toEqual([]);
    await q(
      'UPDATE users SET lifetime_completed_count = lifetime_completed_count WHERE user_id = $1',
      [A.user_id],
    );
    await complete(A, 'Task two');
    const after = (await list(A)).body.data.items.map(
      (i: { title: string }) => i.title,
    );
    expect(after).not.toContain('First Task Completed!');
  });
});
