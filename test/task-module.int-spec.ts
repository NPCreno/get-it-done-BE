/**
 * REF-12: the task services are wired once, the boot generator runs once, and
 * every controller group resolves its service.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';

describe('task module wiring (REF-12)', () => {
  let app: INestApplication;
  let U: TestUser;
  let generatorCalls = 0;

  beforeAll(async () => {
    // Imports are dynamic so the spy exists before the app boots.
    const { TaskGeneratorService } = await import(
      '../src/task/taskGenerator.service'
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original =
      TaskGeneratorService.prototype.generateInstancesForCurrentMonth;
    jest
      .spyOn(TaskGeneratorService.prototype, 'generateInstancesForCurrentMonth')
      .mockImplementation(function (
        this: InstanceType<typeof TaskGeneratorService>,
      ) {
        generatorCalls++;
        return original.call(this);
      });
    app = await createTestApp();
    U = await signupAndLogin(app, 'wire');
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it('S1: the boot generator runs exactly once', () => {
    expect(generatorCalls).toBe(1);
  });

  it('S2: other modules receive the exported instances', async () => {
    const { ProjectsService } = await import(
      '../src/projects/projects.service'
    );
    const { NotificationsService } = await import(
      '../src/notifications/notifications.service'
    );
    const { TaskQueryService } = await import('../src/task/task-query.service');
    const { TaskStreakService } = await import(
      '../src/task/task-streak.service'
    );
    const { TaskService } = await import('../src/task/task.service');
    const projects = app.get(ProjectsService) as unknown as Record<
      string,
      unknown
    >;
    const notifications = app.get(NotificationsService) as unknown as Record<
      string,
      unknown
    >;
    expect(projects.taskQueryService).toBeInstanceOf(TaskQueryService);
    expect(projects.taskQueryService).toBe(
      app.get(TaskQueryService, { strict: false }),
    );
    expect(notifications.taskStreakService).toBeInstanceOf(TaskStreakService);
    expect(notifications.taskStreakService).toBe(
      app.get(TaskStreakService, { strict: false }),
    );
    expect(app.get(TaskService, { strict: false })).toBe(
      app.get(TaskService, { strict: false }),
    );
  });

  it('S3: one request per controller group', async () => {
    const s = () => app.getHttpServer();
    const created = await request(s())
      .post('/api/tasks/create')
      .set(bearer(U))
      .send({
        title: 'wire',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
      });
    expect(created.body.status).toBe('success');
    const taskId = created.body.data.task_id;
    const sub = await request(s())
      .post('/api/tasks/createSubTask')
      .set(bearer(U))
      .send({ task_id: taskId, title: 'sub task', status: 'Pending' });
    expect(sub.body.status).toBe('success');
    const subId = sub.body.data.taskSubInstance_id;
    const now = new Date();
    const qs = `startDate=${new Date(now.getTime() - 864e5).toISOString()}&endDate=${new Date(now.getTime() + 864e5).toISOString()}`;
    expect(
      (
        await request(s())
          .get(`/api/tasks/getTasksByUser/${U.user_id}?${qs}`)
          .set(bearer(U))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(s())
          .get(`/api/tasks/getDashboardData/${U.user_id}?${qs}`)
          .set(bearer(U))
      ).body.status,
    ).toBe('success');
    expect(
      (await request(s()).get(`/api/tasks/streak/${U.user_id}`).set(bearer(U)))
        .body.status,
    ).toBe('success');
    expect(
      (
        await request(s())
          .patch(`/api/tasks/update-subtask-status/${subId}/status/Complete`)
          .set(bearer(U))
      ).status,
    ).toBeLessThan(300);
    expect(
      (
        await request(s())
          .patch(`/api/tasks/update-task-status/${taskId}/status/Complete`)
          .set(bearer(U))
      ).status,
    ).toBeLessThan(300);
    expect(
      (await request(s()).delete(`/api/tasks/subTask/${subId}`).set(bearer(U)))
        .status,
    ).toBeLessThan(300);
    const rec = await request(s())
      .post('/api/tasks/create')
      .set(bearer(U))
      .send({
        title: 'rec',
        priority: 'Low',
        status: 'Pending',
        isRecurring: true,
        repeat_every: 'Day',
        start_date: now.toISOString(),
      });
    expect(rec.body.status).toBe('success');
    const del = await request(s())
      .delete(
        `/api/tasks/deleteRecurringTasks/${rec.body.data.taskTemplate_id}`,
      )
      .set(bearer(U));
    expect(del.status).toBeLessThan(300);
    expect(
      (
        await request(s())
          .get(`/api/projects/getAll/${U.user_id}`)
          .set(bearer(U))
      ).status,
    ).toBe(200);
  });
});
