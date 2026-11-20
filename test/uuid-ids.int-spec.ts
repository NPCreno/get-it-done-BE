/**
 * REF-14b: every business id is `<prefix>-<uuid>`, and rows that still carry
 * the old formats (`user-123456789`, `TMP-<ms>-<n>`, ...) keep working through
 * the API: ids are opaque.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';

const q = <T = any>(sql: string, params: unknown[] = []) =>
  queryDb<T>(BASE_URL, API_TEST_DB, sql, params);
const settle = () => new Promise((r) => setTimeout(r, 800));
const uuidId = (prefix: string) =>
  new RegExp(
    `^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
  );

describe('collision-proof ids (REF-14b)', () => {
  let app: INestApplication;
  let U: TestUser;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    U = await signupAndLogin(app, 'ids');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('I1: new user, project, task, subtask, template, instances and notifications use <prefix>-<uuid>', async () => {
    expect(U.user_id).toMatch(uuidId('user'));

    const prj = await request(server())
      .post('/api/projects/create')
      .set(bearer(U))
      .send({ title: 'Ids project', color: '#336699', colorLabel: 'Blue' });
    expect(prj.body.status).toBe('success');
    expect(prj.body.data.project_id).toMatch(uuidId('PRJ'));

    const task = await request(server())
      .post('/api/tasks/create')
      .set(bearer(U))
      .send({
        title: 'Ids task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        project_id: prj.body.data.project_id,
      });
    expect(task.body.status).toBe('success');
    const taskId = task.body.data.task_id as string;
    expect(taskId).toMatch(uuidId('task'));

    const sub = await request(server())
      .post('/api/tasks/createSubTask')
      .set(bearer(U))
      .send({ task_id: taskId, title: 'Ids subtask', status: 'Pending' });
    expect(sub.body.status).toBe('success');
    expect(sub.body.data.taskSubInstance_id).toMatch(uuidId('subTask'));

    const rec = await request(server())
      .post('/api/tasks/create')
      .set(bearer(U))
      .send({
        title: 'Ids recurring',
        priority: 'Low',
        status: 'Pending',
        isRecurring: true,
        repeat_every: 'Day',
        start_date: new Date().toISOString(),
      });
    expect(rec.body.status).toBe('success');
    const templateId = rec.body.data.taskTemplate_id as string;
    expect(templateId).toMatch(uuidId('TMP'));
    const instances = await q<{ task_id: string }>(
      `SELECT i.task_id FROM task_instance_entity i
         JOIN task_template_entity t ON t.id = i."templateId"
        WHERE t."taskTemplate_id" = $1`,
      [templateId],
    );
    expect(instances.length).toBeGreaterThan(0);
    for (const i of instances)
      expect(i.task_id).toMatch(uuidId('generatedTask'));

    // The recurring generator stays idempotent: a second run adds nothing.
    const { TaskGeneratorService } = await import(
      '../src/task/taskGenerator.service'
    );
    await app
      .get(TaskGeneratorService, { strict: false })
      .generateInstancesForCurrentMonth();
    const again = await q(
      `SELECT count(*)::int AS n FROM task_instance_entity i
         JOIN task_template_entity t ON t.id = i."templateId"
        WHERE t."taskTemplate_id" = $1`,
      [templateId],
    );
    expect(again[0].n).toBe(instances.length);

    await request(server())
      .patch(`/api/tasks/update-task-status/${taskId}/status/Complete`)
      .set(bearer(U));
    await settle();
    const notifs = await q<{ notif_id: string }>(
      'SELECT notif_id FROM notifications WHERE user_id = $1',
      [U.user_id],
    );
    expect(notifs.length).toBeGreaterThan(0);
    for (const n of notifs) expect(n.notif_id).toMatch(uuidId('notif'));
  });

  it('I2: old-format ids still read, update and delete through the API', async () => {
    // A fresh user with no rows yet, renamed to the old format, then logged in
    // again so the token carries the old id.
    const fresh = await signupAndLogin(app, 'oldfmt');
    const oldUser = 'user-012345678';
    await q('UPDATE users SET user_id = $1 WHERE user_id = $2', [
      oldUser,
      fresh.user_id,
    ]);
    const login = await request(server())
      .post('/api/user/loginUsername')
      .send({ username: fresh.username, password: fresh.password });
    expect(login.status).toBeLessThan(300);
    const O = {
      ...fresh,
      user_id: oldUser,
      access: login.body.data.access_token,
    };
    expect(
      (await request(server()).get(`/api/user/get/${oldUser}`).set(bearer(O)))
        .body.user_id,
    ).toBe(oldUser);
    expect(
      (
        await request(server())
          .patch(`/api/user/update/${oldUser}`)
          .set(bearer(O))
          .send({ theme: 'dark' })
      ).status,
    ).toBeLessThan(300);

    // Project: create, then rename before anything references it.
    const prj = await request(server())
      .post('/api/projects/create')
      .set(bearer(O))
      .send({ title: 'Old project', color: '#336699', colorLabel: 'Blue' });
    const oldPrj = 'PRJ-000000042';
    await q('UPDATE project_entity SET project_id = $1 WHERE project_id = $2', [
      oldPrj,
      prj.body.data.project_id,
    ]);
    expect(
      (await request(server()).get(`/api/projects/${oldPrj}`).set(bearer(O)))
        .status,
    ).toBe(200);
    expect(
      (
        await request(server())
          .patch(`/api/projects/${oldPrj}`)
          .set(bearer(O))
          .send({ title: 'Old project renamed' })
      ).body.status,
    ).toBe('success');

    // Task in the old-format project, renamed to the old task format.
    const task = await request(server())
      .post('/api/tasks/create')
      .set(bearer(O))
      .send({
        title: 'Old task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        project_id: oldPrj,
      });
    expect(task.body.status).toBe('success');
    const oldTask = 'task-000000042';
    await q('UPDATE task_instance_entity SET task_id = $1 WHERE task_id = $2', [
      oldTask,
      task.body.data.task_id,
    ]);
    const byProj = await request(server())
      .get(`/api/tasks/getTasksByProj/${oldPrj}`)
      .set(bearer(O));
    expect(JSON.stringify(byProj.body)).toContain(oldTask);
    expect(
      (
        await request(server())
          .patch(`/api/tasks/${oldTask}`)
          .set(bearer(O))
          .send({ title: 'Old task renamed' })
      ).body.status,
    ).toBe('success');

    // Subtask under the old task, renamed to the old subtask format.
    const sub = await request(server())
      .post('/api/tasks/createSubTask')
      .set(bearer(O))
      .send({ task_id: oldTask, title: 'Old subtask', status: 'Pending' });
    expect(sub.body.status).toBe('success');
    const oldSub = 'subTask-1700000000000-42';
    await q(
      `UPDATE task_sub_instance_entity SET "taskSubInstance_id" = $1
        WHERE "taskSubInstance_id" = $2`,
      [oldSub, sub.body.data.taskSubInstance_id],
    );
    expect(
      (
        await request(server())
          .patch(`/api/tasks/update-subtask-status/${oldSub}/status/Complete`)
          .set(bearer(O))
      ).status,
    ).toBeLessThan(300);
    expect(
      (
        await request(server())
          .delete(`/api/tasks/subTask/${oldSub}`)
          .set(bearer(O))
      ).status,
    ).toBeLessThan(300);

    // Template seeded with the old format; the generator and the delete accept it.
    const oldTmp = 'TMP-1700000000000-42';
    await q(
      `INSERT INTO task_template_entity
         (user_id, project_id, "taskTemplate_id", title, repeat_every, start_date)
       VALUES ($1, NULL, $2, 'Old recurring', 'Day', now())`,
      [oldUser, oldTmp],
    );
    const { TaskGeneratorService } = await import(
      '../src/task/taskGenerator.service'
    );
    await app
      .get(TaskGeneratorService, { strict: false })
      .generateInstancesForCurrentMonth();
    const del = await request(server())
      .delete(`/api/tasks/deleteRecurringTasks/${oldTmp}`)
      .set(bearer(O));
    expect(del.body.status).toBe('success');
    expect(del.body.data.deletedInstances.length).toBeGreaterThan(0);

    // Notification seeded with the old format.
    const oldNotif = 'notif-000000042';
    await q(
      `INSERT INTO notifications (notif_id, user_id, type, title, read)
       VALUES ($1, $2, 'achievement', 'Old notification', false)`,
      [oldNotif, oldUser],
    );
    const list = await request(server())
      .get('/api/notifications')
      .set(bearer(O));
    expect(
      (list.body.data.items as { notif_id: string }[]).map((i) => i.notif_id),
    ).toContain(oldNotif);
    expect(
      (
        await request(server())
          .patch(`/api/notifications/${oldNotif}/read`)
          .set(bearer(O))
      ).status,
    ).toBeLessThan(300);

    // Deletes on the old-format task and project, then the user.
    expect(
      (await request(server()).delete(`/api/tasks/${oldTask}`).set(bearer(O)))
        .status,
    ).toBeLessThan(300);
    expect(
      (await request(server()).delete(`/api/projects/${oldPrj}`).set(bearer(O)))
        .status,
    ).toBeLessThan(300);
    expect(
      (await request(server()).delete(`/api/user/${oldUser}`).set(bearer(O)))
        .body.status,
    ).toBe('success');
  });
});
