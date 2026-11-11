/**
 * Cross-user authorization, proven with two real users over real HTTP.
 * Run with `pnpm db:up && pnpm test:int`. Whitelisting is NOT what is tested
 * here: every case asserts that A cannot read or change B's data.
 */
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

describe('authorization (two users)', () => {
  let app: INestApplication;
  let A: TestUser;
  let B: TestUser;
  let bProject: string;
  let bTask: string;
  let bSubTask: string;
  let bTemplate: string;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    A = await signupAndLogin(app, 'a');
    B = await signupAndLogin(app, 'b');

    const p = await request(server())
      .post('/api/projects/create')
      .set(bearer(B))
      .send({ title: 'B project', color: '#112233', colorLabel: 'Blue' });
    bProject = p.body.data.project_id;

    const t = await request(server())
      .post('/api/tasks/create')
      .set(bearer(B))
      .send({
        title: 'B task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        project_id: bProject,
      });
    bTask = t.body.data.task_id;

    const s = await request(server())
      .post('/api/tasks/createSubTask')
      .set(bearer(B))
      .send({ task_id: bTask, title: 'B sub', status: 'Pending' });
    bSubTask = s.body.data.taskSubInstance_id;

    const r = await request(server())
      .post('/api/tasks/create')
      .set(bearer(B))
      .send({
        title: 'B recurring',
        priority: 'Low',
        status: 'Pending',
        isRecurring: true,
        repeat_every: 'Day',
        start_date: new Date().toISOString(),
      });
    bTemplate = r.body.data.taskTemplate_id;
    expect(bProject && bTask && bSubTask && bTemplate).toBeTruthy();
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const rowCount = async (sql: string, params: unknown[] = []) =>
    Number((await q(sql, params))[0].count);

  describe("A's token against B's data", () => {
    it('user update / get', async () => {
      const before = await q(
        'SELECT fullname, username, theme FROM users WHERE user_id = $1',
        [B.user_id],
      );
      const upd = await request(server())
        .patch(`/api/user/update/${B.user_id}`)
        .set(bearer(A))
        .send({ theme: 'dark' });
      expect(upd.status).toBe(401);
      expect(
        (
          await request(server())
            .get(`/api/user/get/${B.user_id}`)
            .set(bearer(A))
        ).status,
      ).toBe(401);
      expect(
        await q(
          'SELECT fullname, username, theme FROM users WHERE user_id = $1',
          [B.user_id],
        ),
      ).toEqual(before);
    });

    it('project get / update / delete leave the row unchanged', async () => {
      const get = await request(server())
        .get(`/api/projects/${bProject}`)
        .set(bearer(A));
      expect(get.body.status).toBe('error');
      expect(get.body.data).toBeUndefined();

      const upd = await request(server())
        .patch(`/api/projects/${bProject}`)
        .set(bearer(A))
        .send({ title: 'hacked' });
      expect(upd.status).toBe(401);

      const del = await request(server())
        .delete(`/api/projects/${bProject}`)
        .set(bearer(A));
      expect(del.status).not.toBe(200);
      const hard = await request(server())
        .delete(`/api/projects/${bProject}/hard`)
        .set(bearer(A));
      expect(hard.body.status === 'error' || hard.status >= 400).toBe(true);

      const rows = await q(
        'SELECT title, "deletedAt" FROM project_entity WHERE project_id = $1',
        [bProject],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('B project');
      expect(rows[0].deletedAt).toBeNull();
    });

    it('task update / status / delete / hard delete leave the row unchanged', async () => {
      const upd = await request(server())
        .patch(`/api/tasks/${bTask}`)
        .set(bearer(A))
        .send({ title: 'hacked' });
      expect(upd.body.status).toBe('error');
      const st = await request(server())
        .patch(`/api/tasks/update-task-status/${bTask}/status/Complete`)
        .set(bearer(A));
      expect(st.body.status === 'error' || st.status >= 400).toBe(true);
      const del = await request(server())
        .delete(`/api/tasks/${bTask}`)
        .set(bearer(A));
      expect(del.body.status === 'error' || del.status >= 400).toBe(true);
      const hard = await request(server())
        .delete(`/api/tasks/${bTask}/hard`)
        .set(bearer(A));
      expect(hard.status).toBeGreaterThanOrEqual(400);

      const rows = await q(
        'SELECT title, status, "deletedAt" FROM task_instance_entity WHERE task_id = $1',
        [bTask],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: 'B task',
        status: 'Pending',
        deletedAt: null,
      });
    });

    it('sub-task status / delete leave the row unchanged', async () => {
      const st = await request(server())
        .patch(`/api/tasks/update-subTask-status/${bSubTask}/status/Complete`)
        .set(bearer(A));
      expect(st.body.status === 'error' || st.status >= 400).toBe(true);
      const del = await request(server())
        .delete(`/api/tasks/subTask/${bSubTask}`)
        .set(bearer(A));
      expect(del.body.status === 'error' || del.status >= 400).toBe(true);
      const rows = await q(
        'SELECT status, "deletedAt" FROM task_sub_instance_entity WHERE "taskSubInstance_id" = $1',
        [bSubTask],
      );
      expect(rows[0]).toMatchObject({ status: 'Pending', deletedAt: null });
    });

    it('recurring template delete leaves the row unchanged', async () => {
      const del = await request(server())
        .delete(`/api/tasks/deleteRecurringTasks/${bTemplate}`)
        .set(bearer(A));
      expect(del.body.status === 'error' || del.status >= 400).toBe(true);
      const rows = await q(
        'SELECT "deletedAt" FROM task_template_entity WHERE "taskTemplate_id" = $1',
        [bTemplate],
      );
      expect(rows[0].deletedAt).toBeNull();
    });

    it('owner can hard delete their own task (relation is loaded)', async () => {
      const t = await request(server())
        .post('/api/tasks/create')
        .set(bearer(B))
        .send({
          title: 'B temp',
          priority: 'Low',
          status: 'Pending',
          isRecurring: false,
        });
      const id = t.body.data.task_id;
      const hard = await request(server())
        .delete(`/api/tasks/${id}/hard`)
        .set(bearer(B));
      expect(hard.status).toBeLessThan(300);
      expect(
        await rowCount(
          'SELECT count(*) FROM task_instance_entity WHERE task_id = $1',
          [id],
        ),
      ).toBe(0);
    });

    it('reads: tasks by project, per-user analytics, notifications clear', async () => {
      const byProj = await request(server())
        .get(`/api/tasks/getTasksByProj/${bProject}`)
        .set(bearer(A));
      expect(byProj.body).toEqual([]);
      for (const path of [
        `getTasksByUser/${B.user_id}`,
        `getDashboardData/${B.user_id}`,
        `completion-trend/${B.user_id}?startDate=2026-01-01&endDate=2026-01-31`,
        `task-distribution/${B.user_id}?month=1&year=2026`,
        `calendar-heatmap/${B.user_id}?month=1&year=2026`,
        `streak/${B.user_id}`,
      ]) {
        expect(
          (await request(server()).get(`/api/tasks/${path}`).set(bearer(A)))
            .status,
        ).toBe(401);
      }
      expect(
        (
          await request(server())
            .get(`/api/projects/getAll/${B.user_id}`)
            .set(bearer(A))
        ).status,
      ).toBe(401);
      expect(
        (
          await request(server())
            .delete(`/api/notifications/clear/${B.user_id}`)
            .set(bearer(A))
        ).status,
      ).toBe(401);
      expect(
        (
          await request(server()).delete(
            `/api/notifications/clear/${B.user_id}`,
          )
        ).status,
      ).toBe(401);
    });
  });

  describe('server-derived identity', () => {
    it('body user_id is ignored: resources belong to the caller', async () => {
      const p = await request(server())
        .post('/api/projects/create')
        .set(bearer(A))
        .send({
          title: 'A project',
          color: '#aabbcc',
          colorLabel: 'Grey',
          user_id: B.user_id,
        });
      expect(p.body.status).toBe('success');
      expect(p.body.data.user_id).toBe(A.user_id);

      const t = await request(server())
        .post('/api/tasks/create')
        .set(bearer(A))
        .send({
          title: 'A task',
          priority: 'Low',
          status: 'Pending',
          isRecurring: false,
          user_id: B.user_id,
          project_id: p.body.data.project_id,
        });
      expect(t.body.status).toBe('success');
      const owner = await q(
        'SELECT user_id FROM task_instance_entity WHERE task_id = $1',
        [t.body.data.task_id],
      );
      expect(owner[0].user_id).toBe(A.user_id);

      const s = await request(server())
        .post('/api/tasks/createSubTask')
        .set(bearer(A))
        .send({
          task_id: t.body.data.task_id,
          title: 'A sub',
          status: 'Pending',
          user_id: B.user_id,
        });
      expect(s.body.status).toBe('success');
      const so = await q(
        'SELECT user_id FROM task_sub_instance_entity WHERE "taskSubInstance_id" = $1',
        [s.body.data.taskSubInstance_id],
      );
      expect(so[0].user_id).toBe(A.user_id);
    });

    it('task in B project is refused and creates no row', async () => {
      const before = await rowCount(
        'SELECT count(*) FROM task_instance_entity WHERE project_id = $1',
        [bProject],
      );
      const t = await request(server())
        .post('/api/tasks/create')
        .set(bearer(A))
        .send({
          title: 'sneaky',
          priority: 'Low',
          status: 'Pending',
          isRecurring: false,
          project_id: bProject,
        });
      expect(t.body.status).toBe('error');
      expect(
        await rowCount(
          'SELECT count(*) FROM task_instance_entity WHERE project_id = $1',
          [bProject],
        ),
      ).toBe(before);
      expect(
        await rowCount(
          "SELECT count(*) FROM task_instance_entity WHERE title = 'sneaky'",
        ),
      ).toBe(0);
    });

    it('sub-task under B task is refused', async () => {
      const s = await request(server())
        .post('/api/tasks/createSubTask')
        .set(bearer(A))
        .send({ task_id: bTask, title: 'sneaky sub', status: 'Pending' });
      expect(s.body.status).toBe('error');
      expect(
        await rowCount(
          "SELECT count(*) FROM task_sub_instance_entity WHERE title = 'sneaky sub'",
        ),
      ).toBe(0);
    });

    it('bulk create with mixed project ids only accepts A own project', async () => {
      const own = await request(server())
        .post('/api/projects/create')
        .set(bearer(A))
        .send({ title: 'A bulk', color: '#000000', colorLabel: 'Black' });
      const res = await request(server())
        .post('/api/tasks/bulk-create')
        .set(bearer(A))
        .send([
          {
            title: 'bulk ok',
            priority: 'Low',
            status: 'Pending',
            isRecurring: false,
            project_id: own.body.data.project_id,
          },
          {
            title: 'bulk bad',
            priority: 'Low',
            status: 'Pending',
            isRecurring: false,
            project_id: bProject,
          },
        ]);
      expect(res.body.data).toHaveLength(1);
      expect(
        await rowCount(
          "SELECT count(*) FROM task_instance_entity WHERE title = 'bulk bad'",
        ),
      ).toBe(0);
      expect(
        await rowCount(
          "SELECT count(*) FROM task_instance_entity WHERE title = 'bulk ok'",
        ),
      ).toBe(1);
    });

    it('bulk sub-tasks under B task are refused', async () => {
      const res = await request(server())
        .post('/api/tasks/bulk-create-subtasks')
        .set(bearer(A))
        .send([
          { task_id: bTask, title: 'bulk sneaky sub', status: 'Pending' },
        ]);
      expect(res.body.status).toBe('error');
      expect(
        await rowCount(
          "SELECT count(*) FROM task_sub_instance_entity WHERE title = 'bulk sneaky sub'",
        ),
      ).toBe(0);
    });
  });

  describe('privilege escalation', () => {
    it('extra fields never reach the row or the next token', async () => {
      const before = (
        await q(
          'SELECT role, tier, email, user_id FROM users WHERE user_id = $1',
          [A.user_id],
        )
      )[0];
      const res = await request(server())
        .patch(`/api/user/update/${A.user_id}`)
        .set(bearer(A))
        .send({
          role: 'admin',
          tier: 'premium',
          email: 'x@y.z',
          user_id: B.user_id,
          theme: 'dark',
        });
      expect(res.status).toBe(200);
      const after = (
        await q(
          'SELECT role, tier, email, user_id, theme FROM users WHERE user_id = $1',
          [A.user_id],
        )
      )[0];
      expect({
        role: after.role,
        tier: after.tier,
        email: after.email,
        user_id: after.user_id,
      }).toEqual(before);
      expect(after.theme).toBe('dark');

      const refreshed = await request(server())
        .post('/api/auth/refresh')
        .send({ refreshToken: A.refresh });
      expect(refreshed.status).toBe(200);
      const jwt = app.get(JwtService);
      const payload = jwt.decode(refreshed.body.data.access_token) as {
        user: { role: string };
      };
      expect(payload.user.role).toBe('standard');
      expect(
        (await request(server()).get('/api/user/getAll').set(bearer(A))).status,
      ).toBe(401);
    });
  });

  describe('token payload', () => {
    it('login and refresh tokens carry no password or internal columns', async () => {
      const jwt = app.get(JwtService);
      const login = await request(server())
        .post('/api/user/loginUsername')
        .send({ username: B.username, password: B.password });
      const fromLogin = jwt.decode(login.body.data.access_token) as {
        user: Record<string, unknown>;
      };
      const refreshed = await request(server())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.data.refresh_token });
      const fromRefresh = jwt.decode(refreshed.body.data.access_token) as {
        user: Record<string, unknown>;
      };
      for (const payload of [fromLogin, fromRefresh]) {
        for (const key of [
          'password',
          'loginAttempts',
          'premiumExpiry',
          'lastLoginAt',
        ]) {
          expect(payload.user).not.toHaveProperty(key);
        }
        expect(payload.user.user_id).toBe(B.user_id);
      }
      expect(Object.keys(fromLogin.user).sort()).toEqual(
        Object.keys(fromRefresh.user).sort(),
      );
    });
  });

  describe('SSE isolation', () => {
    function openStream(port: number, token?: string) {
      return new Promise<{
        status: number;
        chunks: string[];
        close: () => void;
      }>((resolve, reject) => {
        const chunks: string[] = [];
        const req = http.get(
          {
            port,
            path: '/api/notifications/sse',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
          (res) => {
            res.setEncoding('utf8');
            res.on('data', (c) => chunks.push(c));
            resolve({
              status: res.statusCode ?? 0,
              chunks,
              close: () => req.destroy(),
            });
          },
        );
        req.on('error', (e) => {
          if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
        });
      });
    }

    it('rejects an unauthenticated stream and delivers B events to B only', async () => {
      await app.listen(0);
      const port = (app.getHttpServer().address() as AddressInfo).port;

      const anon = await openStream(port);
      expect(anon.status).toBe(401);
      anon.close();

      const a = await openStream(port, A.access);
      const b = await openStream(port, B.access);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const done = await request(server())
        .patch(`/api/tasks/update-task-status/${bTask}/status/Complete`)
        .set(bearer(B));
      expect(done.status).toBeLessThan(300);
      await new Promise((r) => setTimeout(r, 1500));

      expect(b.chunks.join('')).toContain('achievement');
      expect(a.chunks.join('')).not.toContain('achievement');
      a.close();
      b.close();
    });
  });
});
