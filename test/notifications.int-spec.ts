/**
 * Documents why the FE project view now uses the status endpoint: only
 * PATCH update-task-status emits `task.completed`, which creates notifications.
 * PATCH /api/tasks/:id with status Complete is a plain update and creates none.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import * as rules from '../src/notifications/notification.rules.json';

const q = (sql: string, params: unknown[] = []) => queryDb(BASE_URL, API_TEST_DB, sql, params);
const settle = () => new Promise((r) => setTimeout(r, 800));

describe('task completion notifications', () => {
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

  const createTask = async (u: TestUser, title: string) => {
    const r = await request(server()).post('/api/tasks/create').set(bearer(u))
      .send({ title, priority: 'Low', status: 'Pending', isRecurring: false });
    return r.body.data.task_id as string;
  };
  const count = async (u: TestUser) =>
    Number((await q('SELECT count(*) FROM notifications WHERE user_id = $1', [u.user_id]))[0].count);

  it('has a rule that fires on the first completed task (the threshold this test relies on)', () => {
    const all = rules.notifTypes.flatMap((t) => Object.values(t).flat()) as { type: string; condition: { equals?: number } }[];
    expect(all.some((r) => r.type !== 'streak' && r.condition.equals === 1)).toBe(true);
  });

  it('PATCH update-task-status/Complete creates a notification row for the owner', async () => {
    const id = await createTask(A, 'status path');
    const res = await request(server()).patch(`/api/tasks/update-task-status/${id}/status/Complete`).set(bearer(A));
    expect(res.status).toBeLessThan(300);
    await settle();
    expect(await count(A)).toBeGreaterThan(0);
  });

  it('PATCH /api/tasks/:id with status Complete creates no notification row', async () => {
    const id = await createTask(B, 'update path');
    const res = await request(server()).patch(`/api/tasks/${id}`).set(bearer(B)).send({ status: 'Complete' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.status).toBe('success');
    await settle();
    expect(await count(B)).toBe(0);
  });
});
