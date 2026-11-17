/** FEAT-05a: sharing, messages, authorization matrix, paging, delete rules, rate limit, cascades. */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import {
  addMember,
  chatTestLimits,
  createProject,
  sendMessage,
} from './chat-fixtures';
import { API_CONTRACT } from '../src/common/api-contract';

const q = <T = any>(sql: string, params: unknown[] = []) =>
  queryDb<T>(BASE_URL, API_TEST_DB, sql, params);
const F = API_CONTRACT.chat.fields;
const keys = (o: object) => Object.keys(o).sort();
const sorted = (a: readonly string[]) => [...a].sort();

describe('project chat REST (FEAT-05a)', () => {
  let app: INestApplication;
  let O: TestUser; // owner
  let M: TestUser; // member
  let X: TestUser; // second member
  let S: TestUser; // stranger
  let P: string;
  const server = () => app.getHttpServer();
  const get = (u: TestUser, path: string) =>
    request(server()).get(path).set(bearer(u));
  const del = (u: TestUser, path: string) =>
    request(server()).delete(path).set(bearer(u));

  beforeAll(async () => {
    app = await createTestApp(await chatTestLimits());
    O = await signupAndLogin(app, 'owner');
    M = await signupAndLogin(app, 'member');
    X = await signupAndLogin(app, 'xtra');
    S = await signupAndLogin(app, 'stranger');
    P = await createProject(app, O);
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('C1: needs a token on every route', async () => {
    for (const [verb, path] of [
      ['get', '/api/chat/shared-projects'],
      ['get', `/api/chat/projects/${P}/members`],
      ['post', `/api/chat/projects/${P}/members`],
      ['delete', `/api/chat/projects/${P}/members/x`],
      ['get', `/api/chat/projects/${P}/messages`],
      ['post', `/api/chat/projects/${P}/messages`],
      ['delete', `/api/chat/projects/${P}/messages/x`],
    ] as const) {
      const res = await request(server())[verb](path);
      expect([path, res.status, res.body.code]).toEqual([
        path,
        401,
        'TOKEN_MISSING',
      ]);
    }
  });

  it('C2: before sharing, a stranger gets the same 404 as a missing project', async () => {
    const paths = (p: string) => [
      `/api/chat/projects/${p}/members`,
      `/api/chat/projects/${p}/messages`,
    ];
    for (const path of [...paths(P), ...paths('PRJ-000000000')]) {
      const res = await get(M, path);
      expect([path, res.status, res.body.message]).toEqual([
        path,
        404,
        'Project not found',
      ]);
    }
    expect((await sendMessage(app, M, P, 'hi')).status).toBe(404);
    expect((await addMember(app, S, P, M.username)).status).toBe(404);
  });

  it('C3: the owner adds members by exact username', async () => {
    const res = await addMember(app, O, P, M.username);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(keys(res.body.data)).toEqual(sorted(F.member));
    expect(res.body.data).toEqual({
      user_id: M.user_id,
      username: M.username,
      fullname: 'Test member',
    });
    expect((await addMember(app, O, P, X.username)).status).toBe(201);
    const rows = await q(
      'SELECT user_id, added_by FROM project_members WHERE project_id = $1 ORDER BY user_id',
      [P],
    );
    expect(rows).toEqual(
      [M.user_id, X.user_id]
        .sort()
        .map((user_id) => ({ user_id, added_by: O.user_id })),
    );
  });

  it('C4: add errors: 409 already, 400 self, one 404 for unknown, 400 bad name, 403 member, 404 stranger', async () => {
    const again = await addMember(app, O, P, M.username);
    expect([again.status, again.body.message]).toEqual([
      409,
      'Already a member.',
    ]);
    expect((await addMember(app, O, P, O.username)).status).toBe(400);
    const unknown = await addMember(app, O, P, 'nobody_here');
    expect([unknown.status, unknown.body.message]).toEqual([
      404,
      'User not found',
    ]);
    // exact match: no case folding
    expect((await addMember(app, O, P, M.username.toUpperCase())).status).toBe(
      404,
    );
    for (const bad of ['', 'a b', 'x'.repeat(21), 5]) {
      expect((await addMember(app, O, P, bad as string)).status).toBe(400);
    }
    expect((await addMember(app, M, P, S.username)).status).toBe(403);
    expect((await addMember(app, S, P, S.username)).status).toBe(404);
    expect((await addMember(app, O, 'PRJ-000000000', S.username)).status).toBe(
      404,
    );
  });

  it('C5: owner and members list the owner plus members; a stranger gets 404', async () => {
    for (const u of [O, M]) {
      const res = await get(u, `/api/chat/projects/${P}/members`);
      expect(res.status).toBe(200);
      expect(keys(res.body.data)).toEqual(sorted(F.members));
      expect(res.body.data.owner).toEqual({
        user_id: O.user_id,
        username: O.username,
        fullname: 'Test owner',
      });
      expect(
        res.body.data.members.map((m: { user_id: string }) => m.user_id),
      ).toEqual([M.user_id, X.user_id]);
      for (const m of res.body.data.members)
        expect(keys(m)).toEqual(sorted(F.member));
    }
    expect(
      JSON.stringify((await get(O, `/api/chat/projects/${P}/members`)).body),
    ).not.toMatch(/password|email/);
    expect((await get(S, `/api/chat/projects/${P}/members`)).status).toBe(404);
  });

  it('C6: shared-projects lists only projects shared with the caller', async () => {
    const res = await get(M, '/api/chat/shared-projects');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        project_id: P,
        title: 'Shared project',
        color: '#3366ff',
        owner_username: O.username,
      },
    ]);
    expect(keys(res.body.data[0])).toEqual(sorted(F.sharedProject));
    expect((await get(O, '/api/chat/shared-projects')).body.data).toEqual([]);
    expect((await get(S, '/api/chat/shared-projects')).body.data).toEqual([]);
  });

  it('C7: owner and members send; body is trimmed and validated', async () => {
    const res = await sendMessage(app, M, P, '  hello owner  ');
    expect(res.status).toBe(201);
    expect(keys(res.body.data)).toEqual(sorted(F.message));
    expect(res.body.data).toMatchObject({
      project_id: P,
      user_id: M.user_id,
      username: M.username,
      body: 'hello owner',
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.data.created_at).toISOString()).toBe(
      res.body.data.created_at,
    );
    expect((await sendMessage(app, O, P, 'hi member')).status).toBe(201);
    for (const bad of ['', '   ', 'x'.repeat(2001), 42, null]) {
      expect((await sendMessage(app, M, P, bad)).status).toBe(400);
    }
    expect((await sendMessage(app, M, P, 'x'.repeat(2000))).status).toBe(201);
    expect((await sendMessage(app, S, P, 'let me in')).status).toBe(404);
  });

  it('C8: paging is newest first with an opaque cursor, stable on equal timestamps', async () => {
    const P2 = await createProject(app, O, 'Paging');
    await addMember(app, O, P2, M.username);
    // 120 rows, three per millisecond, so the id tie-break matters.
    await q(
      `INSERT INTO chat_messages (id, project_id, user_id, body, created_at)
       SELECT gen_random_uuid(), $1, $2, 'm' || g,
              timestamptz '2026-01-01 00:00:00+00' + ((g / 3) * interval '1 millisecond')
         FROM generate_series(1, 120) g`,
      [P2, M.user_id],
    );
    await q(
      `UPDATE chat_messages SET deleted_at = now()
        WHERE project_id = $1 AND body IN ('m7', 'm8')`,
      [P2],
    );
    const seen: { id: string; created_at: string; body: string }[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(
        O,
        `/api/chat/projects/${P2}/messages?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      expect(keys(res.body.data)).toEqual(sorted(F.messagesPage));
      sizes.push(res.body.data.items.length);
      seen.push(...res.body.data.items);
      cursor = res.body.data.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 18]);
    expect(new Set(seen.map((m) => m.id)).size).toBe(118);
    expect(seen.map((m) => m.body)).not.toContain('m7');
    const expected = await q<{ id: string }>(
      `SELECT id FROM chat_messages WHERE project_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id ASC`,
      [P2],
    );
    expect(seen.map((m) => m.id)).toEqual(expected.map((r) => r.id));
    const first = await get(M, `/api/chat/projects/${P2}/messages`);
    expect(first.body.data.items).toHaveLength(50);
    for (const bad of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'cursor=!!!',
      'cursor=e30',
    ]) {
      const res = await get(O, `/api/chat/projects/${P2}/messages?${bad}`);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
  });

  it('C9: delete: the author or the owner; soft delete; others 403/404', async () => {
    const mine = (await sendMessage(app, M, P, 'by member')).body.data;
    const owners = (await sendMessage(app, O, P, 'by owner')).body.data;
    const xs = (await sendMessage(app, X, P, 'by x')).body.data;
    const path = (id: string) => `/api/chat/projects/${P}/messages/${id}`;

    expect((await del(M, path(owners.id))).status).toBe(403);
    expect((await del(X, path(mine.id))).status).toBe(403);
    expect((await del(S, path(mine.id))).status).toBe(404);

    const own = await del(M, path(mine.id));
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual({ id: mine.id, project_id: P });
    expect(keys(own.body.data)).toEqual(sorted(F.messageDeleted));
    expect((await del(M, path(mine.id))).status).toBe(404);

    expect((await del(O, path(xs.id))).status).toBe(200);
    expect((await del(O, path('not-a-uuid'))).status).toBe(400);
    expect(
      (await del(O, path('3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'))).status,
    ).toBe(404);

    // a message of another project is not reachable through this one
    const P3 = await createProject(app, M, 'Member own');
    const other = (await sendMessage(app, M, P3, 'elsewhere')).body.data;
    expect((await del(O, path(other.id))).status).toBe(404);

    const rows = await q<{ deleted: boolean }>(
      'SELECT deleted_at IS NOT NULL AS deleted FROM chat_messages WHERE id = $1',
      [mine.id],
    );
    expect(rows).toEqual([{ deleted: true }]);
    const ids = (
      await get(O, `/api/chat/projects/${P}/messages`)
    ).body.data.items.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(mine.id);
    expect(ids).not.toContain(xs.id);
    expect(ids).toContain(owners.id);
  });

  it('C10: remove and leave: owner removes anyone, a member only themself', async () => {
    const path = (u: string) => `/api/chat/projects/${P}/members/${u}`;
    expect((await del(M, path(X.user_id))).status).toBe(403);
    expect((await del(S, path(M.user_id))).status).toBe(404);
    expect((await del(O, path(S.user_id))).status).toBe(404);

    const removed = await del(O, path(X.user_id));
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ project_id: P, user_id: X.user_id });
    expect(keys(removed.body.data)).toEqual(sorted(F.memberRemoved));
    expect((await get(X, `/api/chat/projects/${P}/messages`)).status).toBe(404);

    const left = await del(M, path(M.user_id));
    expect(left.status).toBe(200);
    expect((await get(M, `/api/chat/projects/${P}/messages`)).status).toBe(404);
    expect((await get(M, '/api/chat/shared-projects')).body.data).toEqual([
      expect.objectContaining({ title: 'Paging' }),
    ]);
    // their old messages stay in the history
    expect(
      (await get(O, `/api/chat/projects/${P}/messages`)).body.data.items.some(
        (m: { user_id: string }) => m.user_id === M.user_id,
      ),
    ).toBe(true);
  });

  it('C11: at most 20 members', async () => {
    const owner = await signupAndLogin(app, 'bigowner');
    const BP = await createProject(app, owner, 'Big');
    await q(
      `INSERT INTO users (fullname, user_id, username, email, password, tier)
       SELECT 'Bulk ' || g, 'bulk-' || g, 'bulk_' || g, 'bulk' || g || '@example.com', 'x', 'free'
         FROM generate_series(1, 20) g`,
    );
    await q(
      `INSERT INTO project_members (project_id, user_id, added_by)
       SELECT $1, 'bulk-' || g, $2 FROM generate_series(1, 19) g`,
      [BP, owner.user_id],
    );
    expect((await addMember(app, owner, BP, 'bulk_20')).status).toBe(201);
    const over = await addMember(app, owner, BP, S.username);
    expect([over.status, over.body.message]).toEqual([
      400,
      'A project can have at most 20 members.',
    ]);
  });

  it('C12: sending is limited to 30 per minute per user', async () => {
    const R = await signupAndLogin(app, 'chatty');
    const RP = await createProject(app, R, 'Chatty');
    await addMember(app, R, RP, S.username);
    for (let i = 0; i < 30; i++) {
      expect((await sendMessage(app, R, RP, `msg ${i}`)).status).toBe(201);
    }
    const blocked = await sendMessage(app, R, RP, 'one too many');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // another user in the same project is not affected
    expect((await sendMessage(app, S, RP, 'still fine')).status).toBe(201);
    const count = await q<{ n: number }>(
      'SELECT count(*)::int AS n FROM chat_messages WHERE project_id = $1',
      [RP],
    );
    expect(count).toEqual([{ n: 31 }]);
  }, 60000);

  it('C13: a soft-deleted project closes its chat', async () => {
    const SP = await createProject(app, O, 'Soft');
    await addMember(app, O, SP, S.username);
    await sendMessage(app, S, SP, 'before');
    await del(O, `/api/projects/${SP}`);
    expect((await get(S, `/api/chat/projects/${SP}/messages`)).status).toBe(
      404,
    );
    expect((await get(O, `/api/chat/projects/${SP}/messages`)).status).toBe(
      404,
    );
    expect(
      (await get(S, '/api/chat/shared-projects')).body.data.map(
        (p: { project_id: string }) => p.project_id,
      ),
    ).not.toContain(SP);
  });

  it('C14: deleting a project or a user cascades to members and messages', async () => {
    const CP = await createProject(app, O, 'Cascade');
    const U = await signupAndLogin(app, 'leaver');
    await addMember(app, O, CP, U.username);
    await sendMessage(app, U, CP, 'from U');
    await sendMessage(app, U, P, 'from U').expect(404); // not a member of P
    await addMember(app, O, P, U.username);
    await sendMessage(app, U, P, 'from U in P');

    const counts = async () =>
      (
        await q<{ members: number; messages: number }>(
          `SELECT (SELECT count(*)::int FROM project_members WHERE user_id = $1) AS members,
                  (SELECT count(*)::int FROM chat_messages WHERE user_id = $1) AS messages`,
          [U.user_id],
        )
      )[0];
    expect(await counts()).toEqual({ members: 2, messages: 2 });

    const hard = await del(O, `/api/projects/${CP}/hard`);
    expect(hard.body.status).toBe('success');
    expect(
      await q('SELECT 1 FROM project_members WHERE project_id = $1', [CP]),
    ).toEqual([]);
    expect(
      await q('SELECT 1 FROM chat_messages WHERE project_id = $1', [CP]),
    ).toEqual([]);
    expect(await counts()).toEqual({ members: 1, messages: 1 });

    await q('DELETE FROM users WHERE user_id = $1', [U.user_id]);
    expect(await counts()).toEqual({ members: 0, messages: 0 });
  });
});
