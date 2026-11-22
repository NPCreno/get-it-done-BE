/**
 * FEAT-09a shared tasks (plan 41a §7): members see, add, edit, assign and
 * complete a shared project's tasks; deletes follow D1; "my tasks" and stats
 * follow the responsible person; assignment notifications; member removal;
 * the `tasks` SSE event; MCP.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication, MessageEvent } from '@nestjs/common';
import request from 'supertest';
import { Subscription } from 'rxjs';
import type { Client } from '@modelcontextprotocol/client';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import { addMember, createProject } from './chat-fixtures';
import { call, connectMcp, createPat, listen } from './mcp-helpers';
import { API_CONTRACT } from '../src/common/api-contract';
import { NotificationsService } from '../src/notifications/notifications.service';

const q = <T = any>(sql: string, params: unknown[] = []) =>
  queryDb<T>(BASE_URL, API_TEST_DB, sql, params);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const F = API_CONTRACT.tasks.fields;

describe('shared tasks (FEAT-09a)', () => {
  let app: INestApplication;
  let O: TestUser; // owner
  let B: TestUser; // member
  let C: TestUser; // member
  let S: TestUser; // stranger
  let P: string;
  const server = () => app.getHttpServer();
  const get = (u: TestUser, path: string) =>
    request(server()).get(path).set(bearer(u));

  const createTask = async (
    u: TestUser,
    body: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await request(server())
      .post('/api/tasks/create')
      .set(bearer(u))
      .send({
        title: 'Shared task',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        ...body,
      });
    if (res.body?.status !== 'success')
      throw new Error(
        `create failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    return res.body.data.task_id as string;
  };
  const assign = (u: TestUser, taskId: string, assignee: string | null) =>
    request(server())
      .patch(`/api/tasks/${taskId}/assignee`)
      .set(bearer(u))
      .send({ assignee_id: assignee });
  const myTasks = async (u: TestUser): Promise<any[]> =>
    (await get(u, `/api/tasks/getTasksByUser/${u.user_id}`)).body.data;
  const projTasks = (u: TestUser, p = P) =>
    get(u, `/api/tasks/getTasksByProj/${p}`);
  const dashboard = async (u: TestUser) =>
    (await get(u, `/api/tasks/getDashboardData/${u.user_id}`)).body.data;
  const notifs = async (u: TestUser, type = 'assignment') =>
    (await get(u, '/api/notifications')).body.data.items.filter(
      (n: { type: string }) => n.type === type,
    );
  const lifetime = async (u: TestUser) =>
    (
      await q<{ c: number }>(
        'SELECT lifetime_completed_count AS c FROM users WHERE user_id = $1',
        [u.user_id],
      )
    )[0].c;

  beforeAll(async () => {
    app = await createTestApp();
    O = await signupAndLogin(app, 'st_owner');
    B = await signupAndLogin(app, 'st_b');
    C = await signupAndLogin(app, 'st_c');
    S = await signupAndLogin(app, 'st_stranger');
    P = await createProject(app, O, 'Team');
    expect((await addMember(app, O, P, B.username)).status).toBe(201);
    expect((await addMember(app, O, P, C.username)).status).toBe(201);
  }, 90000);

  afterAll(async () => {
    await app?.close();
  });

  it('S1: members list the project tasks; a stranger gets 404', async () => {
    const t = await createTask(O, { project_id: P, title: 'Owner task' });
    for (const u of [O, B, C]) {
      const res = await projTasks(u);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { task_id: string }) => r.task_id)).toContain(t);
    }
    const res = await projTasks(S);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Project not found');
    // and every task route is the same 404 for the stranger
    const upd = await request(server())
      .patch(`/api/tasks/${t}`)
      .set(bearer(S))
      .send({ title: 'xx' });
    expect([upd.status, upd.body.message]).toEqual([404, 'Task not found']);
    expect((await assign(S, t, S.user_id)).status).toBe(404);
  });

  it('S2: a member adds a task; everyone sees it; deletes follow D1', async () => {
    const t = await createTask(B, { project_id: P, title: 'By B' });
    const rowFor = async (u: TestUser) =>
      (await projTasks(u)).body.find(
        (r: { task_id: string }) => r.task_id === t,
      );
    const asOwner = await rowFor(O);
    expect(asOwner).toMatchObject({
      task_id: t,
      project_id: P,
      user_id: B.user_id,
      creator_username: B.username,
      assignee_id: null,
      assignee_username: null,
      can_delete: true,
    });
    for (const k of F.sharing) expect(asOwner).toHaveProperty(k);
    expect((await rowFor(B)).can_delete).toBe(true);
    expect((await rowFor(C)).can_delete).toBe(false);

    // C (member, not the creator) may edit but not delete
    const edit = await request(server())
      .patch(`/api/tasks/${t}`)
      .set(bearer(C))
      .send({ title: 'Edited by C' });
    expect(edit.body.status).toBe('success');
    const del = await request(server())
      .delete(`/api/tasks/${t}`)
      .set(bearer(C));
    expect(del.status).toBe(403);
    expect(del.body.message).toBe(
      "Only the project owner or the task's creator can delete it.",
    );
    const hard = await request(server())
      .delete(`/api/tasks/${t}/hard`)
      .set(bearer(C));
    expect(hard.status).toBe(403);

    // the creator deletes their own; the owner deletes anyone's
    expect(
      (await request(server()).delete(`/api/tasks/${t}`).set(bearer(B))).body
        .status,
    ).toBe('success');
    const t2 = await createTask(C, { project_id: P, title: 'By C' });
    expect(
      (await request(server()).delete(`/api/tasks/${t2}`).set(bearer(O))).body
        .status,
    ).toBe('success');
  });

  it('S2b: sub-tasks: members add and complete them; delete rules', async () => {
    const t = await createTask(O, { project_id: P, title: 'With subs' });
    const sub = await request(server())
      .post('/api/tasks/createSubTask')
      .set(bearer(B))
      .send({ task_id: t, title: 'B sub', status: 'Pending' });
    expect(sub.body.status).toBe('success');
    const subId = sub.body.data.taskSubInstance_id;
    const st = await request(server())
      .patch(`/api/tasks/update-subtask-status/${subId}/status/Complete`)
      .set(bearer(C));
    expect(st.body.status).toBe('success');
    // C is neither the owner, the parent's creator nor the sub-task's creator
    const delC = await request(server())
      .delete(`/api/tasks/subTask/${subId}`)
      .set(bearer(C));
    expect(delC.status).toBe(403);
    const delS = await request(server())
      .delete(`/api/tasks/subTask/${subId}`)
      .set(bearer(S));
    expect([delS.status, delS.body.message]).toEqual([
      404,
      'Subtask not found',
    ]);
    const delB = await request(server())
      .delete(`/api/tasks/subTask/${subId}`)
      .set(bearer(B));
    expect(delB.body.status).toBe('success');
  });

  it('S3: a member completes the owner unassigned task: the owner is credited', async () => {
    const t = await createTask(O, { project_id: P, title: 'Owner to finish' });
    const [o0, b0] = [await lifetime(O), await lifetime(B)];
    const res = await request(server())
      .patch(`/api/tasks/update-task-status/${t}/status/Complete`)
      .set(bearer(B));
    expect(res.body.status).toBe('success');
    expect(await lifetime(O)).toBe(o0 + 1);
    expect(await lifetime(B)).toBe(b0);
  });

  it('S4: assigning moves the task between "my tasks" and notifies once', async () => {
    const t = await createTask(O, { project_id: P, title: 'Hand over' });
    const before = await dashboard(O);
    expect((await myTasks(O)).map((r) => r.task_id)).toContain(t);
    const n0 = (await notifs(B)).length;

    const res = await assign(O, t, B.user_id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toMatchObject({
      task_id: t,
      user_id: O.user_id,
      creator_username: O.username,
      assignee_id: B.user_id,
      assignee_username: B.username,
      can_delete: true,
      project_id: P,
      project_title: 'Team',
      project_owner_username: O.username,
      template_id: null,
      subInstances: [],
    });
    for (const k of [...F.sharing, ...F.userRowExtra])
      expect(res.body.data).toHaveProperty(k);

    expect((await myTasks(O)).map((r) => r.task_id)).not.toContain(t);
    const mine = (await myTasks(B)).find((r) => r.task_id === t);
    expect(mine).toMatchObject({
      assignee_id: B.user_id,
      project_owner_username: O.username,
      can_delete: false,
    });
    expect((await dashboard(O)).all_tasks).toBe(before.all_tasks - 1);

    const n = await notifs(B);
    expect(n).toHaveLength(n0 + 1);
    expect(n[0]).toMatchObject({
      type: 'assignment',
      title: 'New task assigned',
      message: `${O.username} assigned you "Hand over" in Team`,
      read: false,
      actionType: 'acknowledge',
    });
    // the same assignee again: no change, no notification
    expect((await assign(O, t, B.user_id)).status).toBe(200);
    expect(await notifs(B)).toHaveLength(n0 + 1);
    // self-assignment: none
    const t2 = await createTask(B, { project_id: P, title: 'Mine' });
    expect((await assign(B, t2, B.user_id)).status).toBe(200);
    expect(await notifs(B)).toHaveLength(n0 + 1);
    // unassign: none, and the task goes back to its creator
    expect((await assign(O, t, null)).body.data.assignee_id).toBeNull();
    expect((await myTasks(O)).map((r) => r.task_id)).toContain(t);
    expect(await notifs(B)).toHaveLength(n0 + 1);
  });

  it('S4b: creating with an assignee counts as an assignment', async () => {
    const n0 = (await notifs(C)).length;
    const t = await createTask(B, {
      project_id: P,
      title: 'For C',
      assignee_id: C.user_id,
    });
    expect((await myTasks(C)).map((r) => r.task_id)).toContain(t);
    const n = await notifs(C);
    expect(n).toHaveLength(n0 + 1);
    expect(n[0].message).toBe(`${B.username} assigned you "For C" in Team`);
  });

  it('S5: a non-member or a task without a project cannot be assigned', async () => {
    const t = await createTask(O, { project_id: P, title: 'Not for S' });
    const bad = await assign(O, t, S.user_id);
    expect([bad.status, bad.body.message]).toEqual([
      400,
      'Assignee must be a member of this project.',
    ]);
    const personal = await createTask(O, { title: 'Personal' });
    const none = await assign(O, personal, O.user_id);
    expect([none.status, none.body.message]).toEqual([
      400,
      'Only a task in a project can be assigned.',
    ]);
    const body = await assign(O, t, undefined as unknown as null);
    expect(body.status).toBe(400);
    const create = await request(server())
      .post('/api/tasks/create')
      .set(bearer(O))
      .send({
        title: 'x',
        priority: 'Low',
        status: 'Pending',
        isRecurring: false,
        project_id: P,
        assignee_id: S.user_id,
      });
    expect(create.status).toBe(400);
  });

  it('S6: removing a member gives their tasks back to the owner', async () => {
    const R = await signupAndLogin(app, 'st_removed');
    expect((await addMember(app, O, P, R.username)).status).toBe(201);
    const own = await createTask(R, { project_id: P, title: 'R created' });
    const given = await createTask(O, { project_id: P, title: 'Given to R' });
    expect((await assign(O, given, R.user_id)).status).toBe(200);
    const other = await createTask(R, {
      project_id: P,
      title: 'R made for B',
      assignee_id: B.user_id,
    });
    const del = await request(server())
      .delete(`/api/chat/projects/${P}/members/${R.user_id}`)
      .set(bearer(O));
    expect(del.status).toBe(200);
    const rows = await q<{ task_id: string; assignee_id: string | null }>(
      `SELECT task_id, assignee_id FROM task_instance_entity WHERE task_id = ANY($1)`,
      [[own, given, other]],
    );
    const by = Object.fromEntries(rows.map((r) => [r.task_id, r.assignee_id]));
    expect(by).toEqual({
      [own]: O.user_id,
      [given]: O.user_id,
      [other]: B.user_id,
    });
    // the removed member no longer sees the project or the tasks
    expect((await projTasks(R)).status).toBe(404);
    expect((await myTasks(R)).map((r) => r.task_id)).not.toContain(own);
    expect((await myTasks(O)).map((r) => r.task_id)).toEqual(
      expect.arrayContaining([own, given]),
    );
  });

  it('S7: a soft-deleted project hides its tasks from members', async () => {
    const P2 = await createProject(app, O, 'Doomed');
    expect((await addMember(app, O, P2, C.username)).status).toBe(201);
    const t = await createTask(O, {
      project_id: P2,
      title: 'Doomed task',
      assignee_id: C.user_id,
    });
    await request(server())
      .patch(`/api/tasks/update-task-status/${t}/status/Complete`)
      .set(bearer(C));
    const before = await dashboard(C);
    expect((await myTasks(C)).map((r) => r.task_id)).toContain(t);
    // only the project row is deleted, so the task row itself stays live
    await q(
      `UPDATE project_entity SET "deletedAt" = now() WHERE project_id = $1`,
      [P2],
    );
    expect((await myTasks(C)).map((r) => r.task_id)).not.toContain(t);
    expect((await dashboard(C)).complete_tasks).toBe(before.complete_tasks - 1);
    expect((await projTasks(C, P2)).status).toBe(404);
    const upd = await request(server())
      .patch(`/api/tasks/${t}`)
      .set(bearer(C))
      .send({ title: 'xx' });
    expect(upd.status).toBe(404);
  });

  it('S8: hard-deleting the assignee sets assignee_id to null', async () => {
    const D = await signupAndLogin(app, 'st_gone');
    expect((await addMember(app, O, P, D.username)).status).toBe(201);
    const t = await createTask(O, { project_id: P, title: 'For D' });
    expect((await assign(O, t, D.user_id)).status).toBe(200);
    await q('DELETE FROM users WHERE user_id = $1', [D.user_id]);
    const [row] = await q(
      'SELECT assignee_id, "deletedAt" FROM task_instance_entity WHERE task_id = $1',
      [t],
    );
    expect(row).toEqual({ assignee_id: null, deletedAt: null });
  });

  it('S9: a `tasks` SSE event reaches the others, never the actor', async () => {
    const seen = new Map<string, MessageEvent[]>();
    const subs: Subscription[] = [];
    const notifications = app.get(NotificationsService);
    for (const u of [O, B, C, S]) {
      seen.set(u.user_id, []);
      subs.push(
        notifications
          .getNotificationStream(u.user_id)
          .subscribe((e) => seen.get(u.user_id)!.push(e)),
      );
    }
    const tasksEvents = (u: TestUser) =>
      seen
        .get(u.user_id)!
        .filter((e) => e.type === API_CONTRACT.tasks.sseEventType);
    try {
      const t = await createTask(O, { project_id: P, title: 'Live' });
      await settle();
      for (const list of seen.values()) list.length = 0;
      await request(server())
        .patch(`/api/tasks/${t}`)
        .set(bearer(O))
        .send({ title: 'Live edit' });
      await settle();
      for (const u of [B, C])
        expect(tasksEvents(u)).toEqual([
          { type: 'tasks', data: JSON.stringify({ project_id: P }) },
        ]);
      expect(Object.keys(JSON.parse(tasksEvents(B)[0].data as string))).toEqual(
        [...F.tasksEvent],
      );
      expect(tasksEvents(O)).toEqual([]);
      expect(tasksEvents(S)).toEqual([]);

      // an assignment: the bell notification and the tasks event
      for (const list of seen.values()) list.length = 0;
      await assign(O, t, B.user_id);
      await settle();
      const forB = seen.get(B.user_id)!;
      expect(forB.filter((e) => e.type === 'notification')).toHaveLength(1);
      expect(
        JSON.parse(forB.find((e) => e.type === 'notification')!.data as string),
      ).toMatchObject({ type: 'assignment', title: 'New task assigned' });
      expect(tasksEvents(B)).toHaveLength(1);
      expect(tasksEvents(O)).toEqual([]);

      // a personal task sends nothing
      for (const list of seen.values()) list.length = 0;
      const personal = await createTask(O, { title: 'Private' });
      await request(server())
        .patch(`/api/tasks/${personal}`)
        .set(bearer(O))
        .send({ title: 'Private 2' });
      await settle();
      for (const u of [O, B, C]) expect(tasksEvents(u)).toEqual([]);
    } finally {
      subs.forEach((s) => s.unsubscribe());
    }
  });

  it('S10: MCP: list_tasks shows assigned tasks; a member completes a task', async () => {
    const base = await listen(app);
    const mcpB: Client = await connectMcp(
      base,
      (await createPat(app, B)).token,
    );
    const mcpC: Client = await connectMcp(
      base,
      (await createPat(app, C)).token,
    );
    try {
      const t = await createTask(O, { project_id: P, title: 'MCP for B' });
      await assign(O, t, B.user_id);
      const list = await call(mcpB, 'list_tasks', { search: 'MCP for B' });
      expect(list.isError).toBe(false);
      expect(list.data.tasks).toEqual([
        expect.objectContaining({
          task_id: t,
          assignee_username: B.username,
          project_owner_username: O.username,
          project_title: 'Team',
        }),
      ]);
      // the project view lists every task of the project
      const inProject = await call(mcpC, 'list_tasks', {
        project_id: P,
        search: 'MCP for B',
      });
      expect(
        inProject.data.tasks.map((x: { task_id: string }) => x.task_id),
      ).toEqual([t]);
      const done = await call(mcpC, 'set_task_status', {
        task_id: t,
        status: 'Complete',
      });
      expect(done.isError).toBe(false);
      expect(done.data.task.status).toBe('Complete');
      // a member may not delete another member's task, nor move it
      const del = await call(mcpC, 'delete_task', { task_id: t });
      expect([del.isError, del.text]).toEqual([true, 'Not allowed']);
      const mv = await call(mcpC, 'update_task', {
        task_id: t,
        project_id: null,
      });
      expect([mv.isError, mv.text]).toEqual([true, 'Not allowed']);
      // a stranger's PAT: the same 404 as a missing task
      const mcpS = await connectMcp(base, (await createPat(app, S)).token);
      const got = await call(mcpS, 'get_task', { task_id: t });
      expect([got.isError, got.text]).toEqual([true, 'Task not found']);
      await mcpS.close();
    } finally {
      await mcpB.close();
      await mcpC.close();
    }
  });

  it('R1: single-user flows are unchanged (personal tasks, recurring, streak)', async () => {
    const U = await signupAndLogin(app, 'st_solo');
    const t = await createTask(U, { title: 'Solo' });
    expect((await myTasks(U)).map((r) => r.task_id)).toEqual([t]);
    expect((await myTasks(U))[0]).toMatchObject({
      user_id: U.user_id,
      assignee_id: null,
      can_delete: true,
      project_id: null,
      project_owner_username: null,
    });
    await request(server())
      .patch(`/api/tasks/update-task-status/${t}/status/Complete`)
      .set(bearer(U));
    expect(await lifetime(U)).toBe(1);
    const streak = await get(U, `/api/tasks/streak/${U.user_id}`);
    expect(streak.body.data.count).toBe(1);
    const UP = await createProject(app, U, 'Solo project');
    const rec = await request(server())
      .post('/api/tasks/create')
      .set(bearer(U))
      .send({
        title: 'Daily',
        priority: 'Low',
        status: 'Pending',
        isRecurring: true,
        repeat_every: 'Day',
        start_date: new Date().toISOString().slice(0, 10),
        project_id: UP,
      });
    expect(rec.body.status).toBe('success');
    const inst = await q<{ user_id: string; assignee_id: string | null }>(
      `SELECT user_id, assignee_id FROM task_instance_entity WHERE project_id = $1`,
      [UP],
    );
    expect(inst.length).toBeGreaterThan(0);
    for (const i of inst)
      expect(i).toEqual({ user_id: U.user_id, assignee_id: null });
    const del = await request(server())
      .delete(
        `/api/tasks/deleteRecurringTasks/${rec.body.data.taskTemplate_id}`,
      )
      .set(bearer(U));
    expect(del.body.status).toBe('success');
  });
});
