/**
 * Happy-path and input checks for both status endpoints, on the canonical
 * lowercase path. S3 pins that the legacy camelCase path (still sent by an
 * older deployed FE) keeps working: it relies on Express's default
 * case-insensitive routing, and fails if someone turns on case sensitivity.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);

describe('status routes', () => {
  let app: INestApplication;
  let A: TestUser;
  let taskId: string;
  let subId: string;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    A = await signupAndLogin(app, 'a');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  // Fresh task and subtask per case: no case depends on another's result.
  beforeEach(async () => {
    const t = await request(server())
      .post('/api/tasks/create')
      .set(bearer(A))
      .send({
        title: 'status task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
      });
    taskId = t.body.data.task_id;
    const s = await request(server())
      .post('/api/tasks/createSubTask')
      .set(bearer(A))
      .send({ task_id: taskId, title: 'status sub', status: 'Pending' });
    subId = s.body.data.taskSubInstance_id;
    expect(taskId && subId).toBeTruthy();
  });

  const taskStatus = async () =>
    (
      await q('SELECT status FROM task_instance_entity WHERE task_id = $1', [
        taskId,
      ])
    )[0].status;
  const subStatus = async () =>
    (
      await q(
        'SELECT status FROM task_sub_instance_entity WHERE "taskSubInstance_id" = $1',
        [subId],
      )
    )[0].status;

  it('S1: update-task-status/Complete succeeds and persists', async () => {
    const res = await request(server())
      .patch(`/api/tasks/update-task-status/${taskId}/status/Complete`)
      .set(bearer(A));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await taskStatus()).toBe('Complete');
  });

  it('S2: update-subtask-status/Complete (canonical) succeeds and persists', async () => {
    const res = await request(server())
      .patch(`/api/tasks/update-subtask-status/${subId}/status/Complete`)
      .set(bearer(A));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await subStatus()).toBe('Complete');
  });

  it('S3: legacy update-subTask-status path still works and leaves the parent alone', async () => {
    await q(
      `UPDATE task_sub_instance_entity SET status = 'Complete' WHERE "taskSubInstance_id" = $1`,
      [subId],
    );
    const res = await request(server())
      .patch(`/api/tasks/update-subTask-status/${subId}/status/Pending`)
      .set(bearer(A));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await subStatus()).toBe('Pending');
    expect(await taskStatus()).toBe('Pending');
  });

  it('S4: an invalid status is rejected with 400 and the row is unchanged', async () => {
    const t = await request(server())
      .patch(`/api/tasks/update-task-status/${taskId}/status/Done`)
      .set(bearer(A));
    expect(t.status).toBe(400);
    expect(await taskStatus()).toBe('Pending');
    const s = await request(server())
      .patch(`/api/tasks/update-subtask-status/${subId}/status/Done`)
      .set(bearer(A));
    expect(s.status).toBe(400);
    expect(await subStatus()).toBe('Pending');
  });

  it('S5: both routes require a bearer token', async () => {
    for (const path of [
      `/api/tasks/update-task-status/${taskId}/status/Complete`,
      `/api/tasks/update-subtask-status/${subId}/status/Complete`,
    ]) {
      const res = await request(server()).patch(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_MISSING');
    }
    expect(await taskStatus()).toBe('Pending');
    expect(await subStatus()).toBe('Pending');
  });
});
