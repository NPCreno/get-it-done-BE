/**
 * Validation behavior through the real global pipe, plus response fixture
 * capture. WRITE_FIXTURES=1 rewrites test/fixtures/responses/*.json (scrubbed:
 * deterministic ids, no emails) which the frontend vendors via contract:sync.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);
const FIXTURES = join(__dirname, 'fixtures', 'responses');
const WRITE = process.env.WRITE_FIXTURES === '1';

/** Deterministic ids, fixed timestamps, no emails. Date-only strings are kept. */
function scrub(body: unknown): unknown {
  const maps = new Map<string, Map<string, string>>();
  const idRe = /^(user|PRJ|task|TMP|subTask)-[\w-]+$/;
  const text = JSON.stringify(body, (_k, v) => {
    if (typeof v !== 'string') return v;
    const m = idRe.exec(v);
    if (m) {
      const prefix = m[1];
      if (!maps.has(prefix)) maps.set(prefix, new Map());
      const map = maps.get(prefix)!;
      if (!map.has(v))
        map.set(v, `${prefix}-${String(map.size + 1).padStart(9, '0')}`);
      return map.get(v);
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v))
      return '2026-01-15T09:00:00.000Z';
    if (/@/.test(v)) return 'user@example.com';
    return v;
  });
  return JSON.parse(text);
}

function fixture(name: string, body: unknown) {
  if (!WRITE) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(
    join(FIXTURES, `${name}.json`),
    JSON.stringify(scrub(body), null, 2) + '\n',
    'utf8',
  );
}

describe('api contract (integration)', () => {
  let app: INestApplication;
  let A: TestUser;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    A = await signupAndLogin(app, 'a');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const createTask = (body: Record<string, unknown>) =>
    request(server())
      .post('/api/tasks/create')
      .set(bearer(A))
      .send({
        title: 'Task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        ...body,
      });

  describe('recurring validation', () => {
    const weekly = (extra: Record<string, unknown>) =>
      createTask({
        isRecurring: true,
        repeat_every: 'Week',
        start_date: new Date().toISOString(),
        ...extra,
      });

    it.each([[[]], [['']], [['Funday']], [['Monday', 'Monday']]])(
      'repeat_days %j -> 400',
      async (days) => {
        const res = await weekly({ repeat_days: days });
        expect(res.status).toBe(400);
        expect(Array.isArray(res.body.message)).toBe(true);
      },
    );

    it('missing repeat_days on a weekly task -> 400', async () => {
      expect((await weekly({})).status).toBe(400);
    });

    it('valid weekly days -> success; days stored only for Week', async () => {
      const ok = await weekly({ repeat_days: ['Monday', 'Friday'] });
      expect(ok.body.status).toBe('success');
      const daily = await createTask({
        isRecurring: true,
        repeat_every: 'Day',
        start_date: new Date().toISOString(),
        repeat_days: ['Monday'],
      });
      expect(daily.body.status).toBe('success');
      const rows = await q(
        'SELECT repeat_days FROM task_template_entity WHERE "taskTemplate_id" = $1',
        [daily.body.data.taskTemplate_id],
      );
      expect(rows[0].repeat_days).toBeNull();
    });

    it('non-recurring ignores stray recurrence fields', async () => {
      const res = await createTask({ repeat_days: [''], repeat_every: 'Nope' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('end_date before start_date -> 400', async () => {
      const res = await createTask({
        isRecurring: true,
        repeat_every: 'Day',
        start_date: '2026-02-10T00:00:00.000Z',
        end_date: '2026-02-01T00:00:00.000Z',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('input validation', () => {
    it('invalid date -> 400 with an array message', async () => {
      const res = await createTask({ due_date: 'garbage' });
      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
    });

    it('ISO date strings are accepted', async () => {
      const res = await createTask({ due_date: '2026-03-01T10:00:00.000Z' });
      expect(res.body.status).toBe('success');
    });

    it('bad enum values -> 400', async () => {
      expect((await createTask({ priority: 'Urgent' })).status).toBe(400);
      expect((await createTask({ status: 'Overdue' })).status).toBe(400);
    });

    it('bulk endpoints reject invalid items with 400', async () => {
      const t = await request(server())
        .post('/api/tasks/bulk-create')
        .set(bearer(A))
        .send([
          {
            title: 'ok',
            priority: 'Low',
            status: 'Pending',
            isRecurring: false,
          },
          { title: 'x', priority: 'Bad' },
        ]);
      expect(t.status).toBe(400);
      const s = await request(server())
        .post('/api/tasks/bulk-create-subtasks')
        .set(bearer(A))
        .send([{ task_id: 'task-1', title: '', status: 'Pending' }]);
      expect(s.status).toBe(400);
    });

    it('login with a missing password -> 400', async () => {
      const res = await request(server())
        .post('/api/user/loginUsername')
        .send({ username: A.username });
      expect(res.status).toBe(400);
    });

    it('update with a bad theme or boolean string -> 400', async () => {
      expect(
        (
          await request(server())
            .patch(`/api/user/update/${A.user_id}`)
            .set(bearer(A))
            .send({ theme: 'neon' })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(server())
            .patch(`/api/user/update/${A.user_id}`)
            .set(bearer(A))
            .send({ soundFx: 'yes' })
        ).status,
      ).toBe(400);
    });
  });

  describe('accounts', () => {
    it('signup ignores a client tier; password is stored hashed and login works', async () => {
      const res = await request(server())
        .post('/api/user/create')
        .send({
          fullname: 'Tier Test',
          username: 'tier_test',
          email: 'tier@example.com',
          password: 'secret12',
          tier: 'premium',
          role: 'admin',
        });
      expect(res.body.status).toBe('success');
      const row = (
        await q(
          "SELECT tier, role, password FROM users WHERE username = 'tier_test'",
        )
      )[0];
      expect(row.tier).toBe('free');
      expect(row.role).toBe('standard');
      expect(row.password).toMatch(/^\$2[aby]\$/);
      const login = await request(server())
        .post('/api/user/loginUsername')
        .send({ username: 'tier_test', password: 'secret12' });
      expect(login.status).toBe(201);
    });

    it('password change is hashed, login works with the new one, old one fails', async () => {
      const u = await signupAndLogin(app, 'pw');
      await q(
        'UPDATE users SET "updatedAt" = now() - interval \'1 year\' WHERE user_id = $1',
        [u.user_id],
      );
      const res = await request(server())
        .patch(`/api/user/update/${u.user_id}`)
        .set(bearer(u))
        .send({ password: 'newpass99' });
      expect(res.status).toBe(200);
      const row = (
        await q('SELECT password FROM users WHERE user_id = $1', [u.user_id])
      )[0];
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(
        (
          await request(server())
            .post('/api/user/loginUsername')
            .send({ username: u.username, password: 'newpass99' })
        ).status,
      ).toBe(201);
      expect(
        (
          await request(server())
            .post('/api/user/loginUsername')
            .send({ username: u.username, password: u.password })
        ).status,
      ).toBe(401);
    });

    it('duplicate username on update -> 409', async () => {
      const u = await signupAndLogin(app, 'dup');
      await q(
        'UPDATE users SET "updatedAt" = now() - interval \'1 year\' WHERE user_id = $1',
        [u.user_id],
      );
      const res = await request(server())
        .patch(`/api/user/update/${u.user_id}`)
        .set(bearer(u))
        .send({ username: A.username });
      expect(res.status).toBe(409);
    });

    it('loginEmail works', async () => {
      const res = await request(server())
        .post('/api/user/loginEmail')
        .send({ email: A.email, password: A.password });
      expect(res.status).toBe(201);
    });
  });

  describe('auth endpoints are not stripped by the global pipe', () => {
    it('refresh returns tokens and logout revokes the family', async () => {
      const login = await request(server())
        .post('/api/user/loginUsername')
        .send({ username: A.username, password: A.password });
      const refreshed = await request(server())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.data.refresh_token });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.access_token).toBeTruthy();
      const out = await request(server())
        .post('/api/auth/logout')
        .send({ refreshToken: refreshed.body.data.refresh_token });
      expect(out.status).toBe(204);
      const again = await request(server())
        .post('/api/auth/refresh')
        .send({ refreshToken: refreshed.body.data.refresh_token });
      expect(again.status).toBe(401);
    });
  });

  describe('lists and shapes', () => {
    it('new user: empty lists are success; dashboard counts are integers', async () => {
      const c = await signupAndLogin(app, 'empty');
      const tasks = await request(server())
        .get(`/api/tasks/getTasksByUser/${c.user_id}`)
        .set(bearer(c));
      expect(tasks.body.status).toBe('success');
      expect(tasks.body.data).toEqual([]);
      const projects = await request(server())
        .get(`/api/projects/getAll/${c.user_id}`)
        .set(bearer(c));
      expect(projects.body.status).toBe('success');
      expect(projects.body.data).toEqual([]);
      const dash = await request(server())
        .get(`/api/tasks/getDashboardData/${c.user_id}`)
        .set(bearer(c));
      expect(dash.body.status).toBe('success');
      for (const v of Object.values(dash.body.data))
        expect(Number.isInteger(v)).toBe(true);
      fixture('dashboard-empty', dash.body);
      fixture('tasks-empty', tasks.body);
      fixture('projects-empty', projects.body);
    });

    it('getTasksByUser includes project_id; captures fixtures', async () => {
      const proj = await request(server())
        .post('/api/projects/create')
        .set(bearer(A))
        .send({
          title: 'Fixture project',
          description: 'desc',
          color: '#336699',
          colorLabel: 'Blue',
        });
      const pid = proj.body.data.project_id;
      // a project with every nullable column null, inserted directly
      await q(
        'INSERT INTO project_entity (project_id, user_id, title, description, color, "colorLabel", due_date) VALUES (\'PRJ-000000999\', $1, NULL, NULL, NULL, NULL, NULL)',
        [A.user_id],
      );

      const full = await createTask({
        title: 'With everything',
        description: 'details',
        project_id: pid,
        priority: 'High',
        due_date: new Date().toISOString(),
      });
      const bare = await createTask({ title: 'Bare task' });
      await request(server())
        .post('/api/tasks/createSubTask')
        .set(bearer(A))
        .send({
          task_id: full.body.data.task_id,
          title: 'First sub',
          status: 'Pending',
        });
      await createTask({
        isRecurring: true,
        repeat_every: 'Day',
        title: 'Daily',
        start_date: new Date().toISOString(),
      });
      const done = await createTask({
        title: 'Will complete',
        project_id: pid,
      });
      await request(server())
        .patch(
          `/api/tasks/update-task-status/${done.body.data.task_id}/status/Complete`,
        )
        .set(bearer(A));
      await createTask({
        title: 'Null-title project task',
        project_id: 'PRJ-000000999',
      }); // refused: not owned? it is owned by A

      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).toISOString();
      const end = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
      ).toISOString();

      const list = await request(server())
        .get(`/api/tasks/getTasksByUser/${A.user_id}`)
        .query({ startDate: start, endDate: end })
        .set(bearer(A));
      expect(list.body.status).toBe('success');
      const byTitle = (t: string) =>
        list.body.data.find((x: { title: string }) => x.title === t);
      expect(byTitle('With everything').project_id).toBe(pid);
      expect(byTitle('Bare task').project_id).toBeNull();
      expect(byTitle('Bare task').description).toBeNull();
      expect(byTitle('With everything').subInstances).toHaveLength(1);
      expect(byTitle('Bare task').subInstances).toEqual([]);
      const recurring = list.body.data.find(
        (x: { template_id: string | null }) => x.template_id,
      );
      expect(recurring).toBeTruthy();
      fixture('tasks-list', list.body);

      const byProj = await request(server())
        .get(`/api/tasks/getTasksByProj/${pid}`)
        .query({ startDate: start, endDate: end })
        .set(bearer(A));
      expect(byProj.body.length).toBeGreaterThan(0);
      expect(byProj.body[0].project_id).toBe(pid);
      fixture('tasks-by-project', byProj.body);

      const projects = await request(server())
        .get(`/api/projects/getAll/${A.user_id}`)
        .set(bearer(A));
      expect(projects.body.status).toBe('success');
      expect(
        projects.body.data.some(
          (p: { title: string | null }) => p.title === null,
        ),
      ).toBe(true);
      fixture('projects-list', projects.body);
      fixture(
        'project-single',
        (await request(server()).get(`/api/projects/${pid}`).set(bearer(A)))
          .body,
      );
      fixture(
        'project-null-fields',
        (
          await request(server())
            .get('/api/projects/PRJ-000000999')
            .set(bearer(A))
        ).body,
      );

      fixture(
        'user-set',
        await request(server())
          .get(`/api/user/get/${A.user_id}`)
          .set(bearer(A))
          .then((r) => {
            return r.body;
          }),
      );
      const second = await signupAndLogin(app, 'nulltheme');
      await q(
        'UPDATE users SET theme = NULL, "soundFx" = NULL, "enableNotifications" = NULL WHERE user_id = $1',
        [second.user_id],
      );
      fixture(
        'user-null-prefs',
        (
          await request(server())
            .get(`/api/user/get/${second.user_id}`)
            .set(bearer(second))
        ).body,
      );

      const dash = await request(server())
        .get(`/api/tasks/getDashboardData/${A.user_id}`)
        .query({ startDate: start, endDate: end })
        .set(bearer(A));
      fixture('dashboard', dash.body);

      const heat = await request(server())
        .get(`/api/tasks/calendar-heatmap/${A.user_id}`)
        .query({ month: now.getMonth() + 1, year: now.getFullYear() })
        .set(bearer(A));
      fixture('heatmap-month', heat.body);
      const weekStart = new Date(now.getTime() - 6 * 86400000).toISOString();
      const trend = await request(server())
        .get(`/api/tasks/completion-trend/${A.user_id}`)
        .query({ startDate: weekStart, endDate: now.toISOString() })
        .set(bearer(A));
      fixture('trend-week', trend.body);
      const dist = await request(server())
        .get(`/api/tasks/task-distribution/${A.user_id}`)
        .query({ month: now.getMonth() + 1, year: now.getFullYear() })
        .set(bearer(A));
      fixture('distribution', dist.body);
      fixture(
        'streak',
        (
          await request(server())
            .get(`/api/tasks/streak/${A.user_id}`)
            .set(bearer(A))
        ).body,
      );
    });
  });
});
