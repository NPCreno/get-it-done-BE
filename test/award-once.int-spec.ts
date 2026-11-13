/**
 * Each award is given once (TZ=UTC is set by jest-global-tz.js): lifetime counter, award ledger, once-per-streak-run
 * keys, concurrency. TZ=UTC because the streak date basis mixes local and UTC.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const dayStr = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('award once', () => {
  let app: INestApplication;
  let emitSpy: jest.SpyInstance;
  let n = 0;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    emitSpy = jest.spyOn(app.get(EventEmitter2), 'emit');
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => emitSpy.mockClear());

  const newUser = () => signupAndLogin(app, `award${++n}`);
  const createTask = async (u: TestUser) => {
    const r = await request(server())
      .post('/api/tasks/create')
      .set(bearer(u))
      .send({
        title: 'task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
      });
    if (!r.body.data?.task_id) throw new Error(JSON.stringify(r.body));
    return r.body.data.task_id as string;
  };
  const setStatus = (u: TestUser, id: string, s: string) =>
    request(server())
      .patch(`/api/tasks/update-task-status/${id}/status/${s}`)
      .set(bearer(u));
  const complete = (u: TestUser, id: string) => setStatus(u, id, 'Complete');
  const lifetime = async (u: TestUser) =>
    Number(
      (
        await q(
          'SELECT lifetime_completed_count AS c FROM users WHERE user_id=$1',
          [u.user_id],
        )
      )[0].c,
    );
  const notifs = async (u: TestUser, title: string) =>
    Number(
      (
        await q(
          'SELECT count(*) FROM notifications WHERE user_id=$1 AND title=$2',
          [u.user_id, title],
        )
      )[0].count,
    );
  const keys = async (u: TestUser) =>
    (
      await q('SELECT award_key FROM user_awards WHERE user_id=$1 ORDER BY 1', [
        u.user_id,
      ])
    ).map((r) => r.award_key as string);
  const completedEvents = () =>
    emitSpy.mock.calls.filter((c) => c[0] === 'task.completed');
  /** Seeds an already-Complete task whose completion date is `daysAgo` days back (no counter, no event). */
  const seedCompleted = async (u: TestUser, daysAgo: number) => {
    const id = await createTask(u);
    await q(
      `UPDATE task_instance_entity SET status='Complete', "updatedAt" = now() - ($2 || ' days')::interval WHERE task_id=$1`,
      [id, String(daysAgo)],
    );
  };

  it('T1 first completion: one "First Task Completed!", lifetime 1, key set', async () => {
    const u = await newUser();
    await complete(u, await createTask(u));
    await settle();
    expect(await notifs(u, 'First Task Completed!')).toBe(1);
    expect(await lifetime(u)).toBe(1);
    expect(await keys(u)).toContain('achievement:eq:1');
  });

  it('T2 complete -> Pending -> Complete: no second award; lifetime never drops', async () => {
    const u = await newUser();
    const id = await createTask(u);
    await complete(u, id);
    await settle();
    await setStatus(u, id, 'Pending');
    expect(await lifetime(u)).toBe(1);
    await complete(u, id);
    await settle();
    expect(await notifs(u, 'First Task Completed!')).toBe(1);
    expect(await lifetime(u)).toBe(2);
  });

  it('T3 PATCH Complete twice: second is "already set", no event, no change', async () => {
    const u = await newUser();
    const id = await createTask(u);
    await complete(u, id);
    await settle();
    const before = await q(
      'SELECT count(*) FROM notifications WHERE user_id=$1',
      [u.user_id],
    );
    emitSpy.mockClear();
    const again = await complete(u, id);
    expect(again.body.message).toContain('already set');
    await settle();
    expect(completedEvents()).toHaveLength(0);
    expect(await lifetime(u)).toBe(1);
    expect(
      await q('SELECT count(*) FROM notifications WHERE user_id=$1', [
        u.user_id,
      ]),
    ).toEqual(before);
  });

  it('T4 three completions on one day: one "1-Day Streak", one streak key', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await complete(u, await createTask(u));
    await settle();
    expect(await notifs(u, '1-Day Streak')).toBe(1);
    expect((await keys(u)).filter((k) => k.startsWith('streak:'))).toEqual([
      `streak:eq:1:${dayStr(0)}`,
    ]);
  });

  it('T5 new streak after a break notifies "1-Day Streak" again', async () => {
    const u = await newUser();
    for (const d of [6, 5, 4]) await seedCompleted(u, d);
    await q(
      `INSERT INTO user_awards (user_id, award_key) VALUES ($1,$2),($1,$3)`,
      [u.user_id, `streak:eq:1:${dayStr(-6)}`, `streak:eq:3:${dayStr(-6)}`],
    );
    await complete(u, await createTask(u));
    await settle();
    expect(await notifs(u, '1-Day Streak')).toBe(1);
    expect(await keys(u)).toContain(`streak:eq:1:${dayStr(0)}`);
    expect(await keys(u)).toContain(`streak:eq:1:${dayStr(-6)}`);
  });

  it('T6 a run spanning a month end is one run (start before the boundary)', async () => {
    const u = await newUser();
    const now = new Date();
    const lastPrev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
    ); // last day of previous month
    const startOffset = Math.round(
      (lastPrev.getTime() - 86_400_000 - new Date(dayStr(0)).getTime()) /
        86_400_000,
    ); // lastPrev - 1, as a negative day offset
    for (let d = -startOffset; d >= 1; d--) await seedCompleted(u, d);
    await complete(u, await createTask(u));
    const expected = -startOffset + 1;
    const res = await request(server())
      .get(`/api/tasks/streak/${u.user_id}`)
      .set(bearer(u));
    expect(res.body.data.count).toBe(expected);
    await settle();
    // any streak award for this run carries the run's start date
    for (const k of (await keys(u)).filter((k) => k.startsWith('streak:')))
      expect(k.endsWith(`:${dayStr(startOffset)}`)).toBe(true);
  });

  it('T7 milestones: every 10 once, revert + re-complete does not repeat, none at 15', async () => {
    const u = await newUser();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await createTask(u);
      ids.push(id);
      await complete(u, id);
    }
    await settle(1500);
    const mk = async () =>
      (await keys(u)).filter((k) => k.startsWith('milestone:'));
    expect(await mk()).toEqual(['milestone:every:10:10']);
    expect(await notifs(u, 'Milestone Achieved!')).toBe(1);

    await setStatus(u, ids[0], 'Pending');
    await complete(u, ids[0]); // lifetime 11
    for (let i = 0; i < 9; i++) await complete(u, await createTask(u)); // 20
    await settle(1500);
    expect(await lifetime(u)).toBe(20);
    expect(await mk()).toEqual([
      'milestone:every:10:10',
      'milestone:every:10:20',
    ]);
    for (let i = 0; i < 10; i++) await complete(u, await createTask(u)); // 30
    await settle(1500);
    expect(await mk()).toEqual([
      'milestone:every:10:10',
      'milestone:every:10:20',
      'milestone:every:10:30',
    ]);
    expect(await notifs(u, 'Milestone Achieved!')).toBe(3);
    expect(await notifs(u, 'Surprise Reward 🎁')).toBe(1);
  }, 120000);

  it('T8 clearing notifications does not re-award', async () => {
    const u = await newUser();
    await complete(u, await createTask(u));
    await settle();
    const res = await request(server())
      .delete(`/api/notifications/clear/${u.user_id}`)
      .set(bearer(u));
    expect(res.status).toBeLessThan(300);
    expect(await notifs(u, 'First Task Completed!')).toBe(0);
    await complete(u, await createTask(u));
    await settle();
    expect(await notifs(u, 'First Task Completed!')).toBe(0);
    expect(await keys(u)).toContain('achievement:eq:1');
  });

  it('T9 concurrent completion of one task: one transition, +1, one event', async () => {
    const u = await newUser();
    const id = await createTask(u);
    const [a, b] = await Promise.all([complete(u, id), complete(u, id)]);
    await settle();
    const msgs = [a.body.message, b.body.message].sort();
    expect(msgs.filter((m: string) => m.includes('already set'))).toHaveLength(
      1,
    );
    expect(await lifetime(u)).toBe(1);
    expect(completedEvents()).toHaveLength(1);
    expect(await notifs(u, 'First Task Completed!')).toBe(1);
  });

  it('T10 concurrent completion of two tasks: lifetime +2, distinct counts', async () => {
    const u = await newUser();
    const [t1, t2] = [await createTask(u), await createTask(u)];
    await Promise.all([complete(u, t1), complete(u, t2)]);
    await settle();
    expect(await lifetime(u)).toBe(2);
    const counts = completedEvents()
      .map((c) => c[1].lifetimeCount as number)
      .sort();
    expect(counts).toEqual([1, 2]);
  });

  it('T11 concurrent completions at a streak threshold: one streak row', async () => {
    const u = await newUser();
    await seedCompleted(u, 2);
    await seedCompleted(u, 1);
    const [t1, t2] = [await createTask(u), await createTask(u)];
    await Promise.all([complete(u, t1), complete(u, t2)]);
    await settle(1500);
    expect(await notifs(u, '3-Day Streak')).toBe(1);
    expect(await keys(u)).toContain(`streak:eq:3:${dayStr(-2)}`);
  });

  it('T12 deleting a completed task does not lower lifetime', async () => {
    const u = await newUser();
    const id = await createTask(u);
    await complete(u, id);
    await settle();
    const del = await request(server())
      .delete(`/api/tasks/${id}`)
      .set(bearer(u));
    expect(del.status).toBeLessThan(300);
    expect(await lifetime(u)).toBe(1);
  });

  it('T13 PATCH /api/tasks/:id Complete: no event, award or counter change', async () => {
    const u = await newUser();
    const id = await createTask(u);
    const res = await request(server())
      .patch(`/api/tasks/${id}`)
      .set(bearer(u))
      .send({ status: 'Complete' });
    expect(res.body.status).toBe('success');
    await settle();
    expect(completedEvents()).toHaveLength(0);
    expect(await lifetime(u)).toBe(0);
    expect(await keys(u)).toEqual([]);
  });

  it('S4 updatedAt advances on a status change and the streak endpoint sees it', async () => {
    const u = await newUser();
    const id = await createTask(u);
    await q(
      `UPDATE task_instance_entity SET "updatedAt" = now() - interval '3 days' WHERE task_id=$1`,
      [id],
    );
    const before = (
      await q('SELECT "updatedAt" FROM task_instance_entity WHERE task_id=$1', [
        id,
      ])
    )[0].updatedAt as Date;
    await complete(u, id);
    const after = (
      await q('SELECT "updatedAt" FROM task_instance_entity WHERE task_id=$1', [
        id,
      ])
    )[0].updatedAt as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime() + 86_400_000);
    const s = await request(server())
      .get(`/api/tasks/streak/${u.user_id}`)
      .set(bearer(u));
    expect(s.body.data.count).toBe(1);
    const now = new Date();
    const h = await request(server())
      .get(
        `/api/tasks/calendar-heatmap/${u.user_id}?month=${String(now.getUTCMonth() + 1).padStart(2, '0')}&year=${now.getUTCFullYear()}`,
      )
      .set(bearer(u));
    expect(
      (h.body.data as { value: number }[]).reduce((a, d) => a + d.value, 0),
    ).toBe(1);
  });
});
