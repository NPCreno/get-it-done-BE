/**
 * FEAT-07a: the MCP endpoint end to end, with the SDK's own v2 client over
 * Streamable HTTP against the real app: handshake, the personal access token
 * gate, per-user scoping, awards, soft deletes, Origin and the rate limit.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from '@modelcontextprotocol/client';
import { createTestApp } from './int-app';
import { bearer, signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import {
  addMember,
  chatTestLimits,
  createProject,
  sendMessage,
} from './chat-fixtures';
import {
  call,
  connectMcp,
  createPat,
  listen,
  rawInitialize,
} from './mcp-helpers';

const q = <T = any>(sql: string, params: unknown[] = []) =>
  queryDb<T>(BASE_URL, API_TEST_DB, sql, params);
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

const TOOL_NAMES = [
  'get_profile',
  'get_dashboard',
  'list_notifications',
  'mark_notification_read',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'set_task_status',
  'assign_task',
  'add_subtask',
  'set_subtask_status',
  'delete_task',
  'delete_subtask',
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'delete_project',
  'list_shared_projects',
  'list_project_members',
  'list_chat_messages',
  'get_chat_unread',
].sort();

describe('MCP endpoint (FEAT-07a)', () => {
  let app: INestApplication;
  let base: string;
  let A: TestUser;
  let B: TestUser;
  let patA: { id: string; token: string };
  let patB: { id: string; token: string };
  let mcpA: Client;
  let mcpB: Client;

  beforeAll(async () => {
    app = await createTestApp();
    base = await listen(app);
    A = await signupAndLogin(app, 'mcpa');
    B = await signupAndLogin(app, 'mcpb');
    patA = await createPat(app, A);
    patB = await createPat(app, B);
    mcpA = await connectMcp(base, patA.token);
    mcpB = await connectMcp(base, patB.token);
  }, 60000);

  afterAll(async () => {
    await mcpA?.close();
    await mcpB?.close();
    await app?.close();
  });

  describe('handshake', () => {
    it('initialize works for a 2025-11-25 client', () => {
      expect(mcpA.getNegotiatedProtocolVersion()).toBe('2025-11-25');
      expect(mcpA.getServerVersion()?.name).toBe('get-it-done');
      expect(mcpA.getInstructions()).toMatch(/ISO 8601 in UTC/);
      expect(mcpA.getInstructions()).toMatch(/soft/);
    });

    it('a 2026-07-28 client negotiates the modern era', async () => {
      const modern = await connectMcp(base, patA.token, 'auto');
      try {
        expect(modern.getProtocolEra()).toBe('modern');
        const r = await call(modern, 'get_profile');
        expect(r.isError).toBe(false);
        expect(r.data.username).toBe(A.username);
      } finally {
        await modern.close();
      }
    });

    it('tools/list returns exactly the 23 tools with their annotations', async () => {
      const { tools } = await mcpA.listTools();
      expect(tools).toHaveLength(23);
      expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
      const by = Object.fromEntries(tools.map((t) => [t.name, t]));
      for (const n of ['delete_task', 'delete_subtask', 'delete_project'])
        expect(by[n].annotations?.destructiveHint).toBe(true);
      for (const n of [
        'list_tasks',
        'get_task',
        'get_dashboard',
        'list_chat_messages',
      ])
        expect(by[n].annotations?.readOnlyHint).toBe(true);
      for (const n of [
        'update_task',
        'update_project',
        'mark_notification_read',
      ])
        expect(by[n].annotations?.idempotentHint).toBe(true);
      for (const t of tools) {
        expect(t.inputSchema.additionalProperties).toBe(false);
        expect(t.outputSchema).toBeDefined();
        expect(JSON.stringify(t.inputSchema)).not.toContain('user_id');
      }
    });
  });

  describe('the token gate', () => {
    const expect401 = async (headers: Record<string, string>) => {
      const res = await rawInitialize(base, headers);
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate') ?? '';
      expect(challenge).toMatch(/^Bearer/);
      // FEAT-07c: the challenge points OAuth clients at the metadata.
      expect(challenge).toContain(
        'resource_metadata="http://localhost:8000/.well-known/oauth-protected-resource/mcp"',
      );
    };

    it('no token -> 401 with a Bearer challenge', async () => {
      await expect401({});
    });

    it("the website's JWT -> 401", async () => {
      await expect401({ Authorization: `Bearer ${A.access}` });
    });

    it('a PAT on the REST API -> 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tasks/getTasksByUser/${A.user_id}`)
        .set('Authorization', `Bearer ${patA.token}`);
      expect(res.status).toBe(401);
      const tokens = await request(app.getHttpServer())
        .get('/api/tokens')
        .set('Authorization', `Bearer ${patA.token}`);
      expect(tokens.status).toBe(401);
    });

    it('a revoked token -> 401', async () => {
      const pat = await createPat(app, A, { name: 'to revoke' });
      expect(
        (await rawInitialize(base, { Authorization: `Bearer ${pat.token}` }))
          .status,
      ).toBe(200);
      await request(app.getHttpServer())
        .delete(`/api/tokens/${pat.id}`)
        .set(bearer(A))
        .expect(200);
      await expect401({ Authorization: `Bearer ${pat.token}` });
    });

    it('an expired token -> 401', async () => {
      const pat = await createPat(app, A, {
        name: 'to expire',
        expires_in_days: 30,
      });
      await q(
        `UPDATE personal_access_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [pat.id],
      );
      await expect401({ Authorization: `Bearer ${pat.token}` });
    });

    it('a deleted user -> 401', async () => {
      const C = await signupAndLogin(app, 'mcpc');
      const pat = await createPat(app, C);
      await q(`UPDATE users SET "deletedAt" = now() WHERE user_id = $1`, [
        C.user_id,
      ]);
      await expect401({ Authorization: `Bearer ${pat.token}` });
    });

    it('a 2025 GET or DELETE on /mcp is 405 (stateless)', async () => {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${base}/mcp`, {
          method,
          headers: {
            Authorization: `Bearer ${patA.token}`,
            Accept: 'text/event-stream',
            'MCP-Protocol-Version': '2025-11-25',
          },
        });
        expect(res.status).toBe(405);
      }
    });

    it('a disallowed Origin -> 403 (DNS rebinding)', async () => {
      const res = await rawInitialize(base, {
        Authorization: `Bearer ${patA.token}`,
        Origin: 'https://evil.example.com',
      });
      expect(res.status).toBe(403);
    });

    it('records last_used_at', async () => {
      const [row] = await q(
        'SELECT last_used_at FROM personal_access_tokens WHERE id = $1',
        [patA.id],
      );
      expect(row.last_used_at).not.toBeNull();
    });

    it('accepts a body over the 100 kB default (1 MB limit)', async () => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${patA.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'list_tasks',
            arguments: { search: 'x'.repeat(300_000) },
          },
        }),
      });
      expect(res.status).not.toBe(413);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('tools', () => {
    let taskId: string;

    it('create_task, list_tasks, get_task, update_task', async () => {
      const created = await call(mcpA, 'create_task', {
        title: 'Write report',
        description: 'quarterly',
        due_date: '2026-11-25T10:00:00Z',
        priority: 'High',
      });
      expect(created.isError).toBe(false);
      taskId = created.data.task.task_id;
      expect(created.data.task).toMatchObject({
        title: 'Write report',
        priority: 'High',
        status: 'Pending',
        due_date: '2026-11-25T10:00:00.000Z',
      });
      // safe shape: no user objects or internal ids
      expect(JSON.stringify(created)).not.toMatch(
        /"user"|"id"|password|user_id/,
      );
      expect(created.text).toContain('Created task');

      const list = await call(mcpA, 'list_tasks', { search: 'REPORT' });
      expect(
        list.data.tasks.map((t: { task_id: string }) => t.task_id),
      ).toEqual([taskId]);

      const sub = await call(mcpA, 'add_subtask', {
        task_id: taskId,
        title: 'Draft',
      });
      expect(sub.isError).toBe(false);
      const got = await call(mcpA, 'get_task', { task_id: taskId });
      expect(got.data.task.subtask_count).toBe(1);
      expect(got.data.subtasks[0].title).toBe('Draft');
      const subDone = await call(mcpA, 'set_subtask_status', {
        subtask_id: sub.data.subtask.subtask_id,
        status: 'Complete',
      });
      expect(subDone.data.subtask.status).toBe('Complete');

      const upd = await call(mcpA, 'update_task', {
        task_id: taskId,
        title: 'Write the report',
        due_date: null,
      });
      expect(upd.isError).toBe(false);
      expect(upd.data.task).toMatchObject({
        title: 'Write the report',
        due_date: null,
      });
    });

    it('validation errors come back as isError with the REST message', async () => {
      const r = await call(mcpA, 'create_task', {
        title: 'Gym',
        is_recurring: true,
        repeat_every: 'Week',
        start_date: '2026-11-20',
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/repeat_days/);
      const unknown = await call(mcpA, 'list_tasks', { user_id: B.user_id });
      expect(unknown.isError).toBe(true);
      const empty = await call(mcpA, 'update_task', { task_id: taskId });
      expect(empty).toMatchObject({ isError: true });
      expect(empty.text).toMatch(/Nothing to update/);
    });

    it("another user's task is 'Task not found', exactly like a missing one", async () => {
      const missing = await call(mcpB, 'get_task', {
        task_id: 'TSK-does-not-exist',
      });
      for (const [tool, args] of [
        ['get_task', { task_id: taskId }],
        ['update_task', { task_id: taskId, title: 'hijacked' }],
        ['set_task_status', { task_id: taskId, status: 'Complete' }],
        ['add_subtask', { task_id: taskId, title: 'nope nope' }],
        ['delete_task', { task_id: taskId }],
      ] as const) {
        const r = await call(mcpB, tool, args);
        expect([tool, r.isError, r.text]).toEqual([
          tool,
          true,
          'Task not found',
        ]);
      }
      expect(missing).toMatchObject({ isError: true, text: 'Task not found' });
      const [row] = await q(
        'SELECT title, status, "deletedAt" FROM task_instance_entity WHERE task_id = $1',
        [taskId],
      );
      expect(row).toEqual({
        title: 'Write the report',
        status: 'Pending',
        deletedAt: null,
      });
      expect((await call(mcpB, 'list_tasks')).data.count).toBe(0);
    });

    it('set_task_status Complete writes the award notification exactly once', async () => {
      const first = await call(mcpA, 'set_task_status', {
        task_id: taskId,
        status: 'Complete',
      });
      expect(first.data.task.status).toBe('Complete');
      await settle();
      await call(mcpA, 'set_task_status', {
        task_id: taskId,
        status: 'Pending',
      });
      await call(mcpA, 'set_task_status', {
        task_id: taskId,
        status: 'Complete',
      });
      await settle();
      const rows = await q(
        `SELECT count(*)::int AS n FROM notifications n
          WHERE n.user_id = $1 AND n.title = 'First Task Completed!'`,
        [A.user_id],
      );
      expect(rows[0].n).toBe(1);
      const notifs = await call(mcpA, 'list_notifications', {
        unread_only: true,
      });
      const firstTask = notifs.data.notifications.find(
        (n: { title: string }) => n.title === 'First Task Completed!',
      );
      expect(firstTask).toBeDefined();
      const read = await call(mcpA, 'mark_notification_read', {
        notif_id: firstTask.notif_id,
      });
      expect(read.data).toEqual({ notif_id: firstTask.notif_id, read: true });
      const foreign = await call(mcpB, 'mark_notification_read', {
        notif_id: firstTask.notif_id,
      });
      expect(foreign).toMatchObject({
        isError: true,
        text: 'Notification not found',
      });
    });

    it('a destructive call soft-deletes: gone from list_tasks, the row remains', async () => {
      const t = await call(mcpA, 'create_task', { title: 'Throwaway' });
      const id = t.data.task.task_id as string;
      const del = await call(mcpA, 'delete_task', { task_id: id });
      expect(del.data).toEqual({ task_id: id, deleted: true });
      const list = await call(mcpA, 'list_tasks');
      expect(
        list.data.tasks.map((x: { task_id: string }) => x.task_id),
      ).not.toContain(id);
      const [row] = await q(
        'SELECT "deletedAt" FROM task_instance_entity WHERE task_id = $1',
        [id],
      );
      expect(row.deletedAt).not.toBeNull();
      expect((await call(mcpA, 'get_task', { task_id: id })).text).toBe(
        'Task not found',
      );
    });

    it('projects: create, list with counts, get, update, move a task, delete', async () => {
      const p = await call(mcpA, 'create_project', {
        title: 'Home',
        color: 'Mint',
      });
      expect(p.data.project).toMatchObject({
        color: '#B5EAD7',
        color_label: 'Mint',
        task_count: 0,
      });
      const pid = p.data.project.project_id as string;
      const moved = await call(mcpA, 'update_task', {
        task_id: taskId,
        project_id: pid,
      });
      expect(moved.data.task).toMatchObject({
        project_id: pid,
        project_title: 'Home',
      });
      const list = await call(mcpA, 'list_projects');
      expect(list.data.projects).toEqual([
        expect.objectContaining({
          project_id: pid,
          task_count: 1,
          tasks_completed: 1,
        }),
      ]);
      const got = await call(mcpA, 'get_project', { project_id: pid });
      expect(got.data.tasks.map((x: { task_id: string }) => x.task_id)).toEqual(
        [taskId],
      );
      expect((await call(mcpB, 'get_project', { project_id: pid })).text).toBe(
        'Project not found',
      );
      expect(
        (await call(mcpB, 'update_task', { task_id: 'x', project_id: pid }))
          .text,
      ).toBe('Task not found');
      const upd = await call(mcpA, 'update_project', {
        project_id: pid,
        color: 'Coral',
        description: 'chores',
      });
      expect(upd.data.project).toMatchObject({
        color_label: 'Coral',
        description: 'chores',
      });
      const out = await call(mcpA, 'update_task', {
        task_id: taskId,
        project_id: null,
      });
      expect(out.data.task.project_id).toBeNull();
      expect(
        (await call(mcpB, 'delete_project', { project_id: pid })).text,
      ).toBe('Project not found');
      const del = await call(mcpA, 'delete_project', { project_id: pid });
      expect(del.data).toEqual({ project_id: pid, deleted: true });
      expect((await call(mcpA, 'list_projects')).data.count).toBe(0);
    });

    it('a recurring create_task returns the series', async () => {
      const r = await call(mcpA, 'create_task', {
        title: 'Standup',
        is_recurring: true,
        repeat_every: 'Day',
        start_date: new Date().toISOString().slice(0, 10),
      });
      expect(r.isError).toBe(false);
      expect(r.data.recurring).toMatchObject({
        title: 'Standup',
        repeat_every: 'Day',
      });
      const list = await call(mcpA, 'list_tasks', { search: 'Standup' });
      expect(list.data.tasks[0]?.is_recurring).toBe(true);
    });

    it('profile and dashboard', async () => {
      const prof = await call(mcpA, 'get_profile');
      expect(prof.data).toEqual({
        username: A.username,
        fullname: 'Test mcpa',
        email: A.email,
        theme: null,
      });
      const dash = await call(mcpA, 'get_dashboard');
      expect(dash.isError).toBe(false);
      expect(dash.data.completed).toBeGreaterThanOrEqual(1);
      expect(dash.data.streak_days).toBeGreaterThanOrEqual(1);
      const bad = await call(mcpA, 'get_dashboard', {
        from: '2026-12-01',
        to: '2026-11-01',
      });
      expect(bad).toMatchObject({
        isError: true,
        text: 'from must be before to',
      });
    });

    it('chat: shared projects, messages and unread counts, access checked', async () => {
      const pid = await createProject(app, B, 'Shared with A');
      await addMember(app, B, pid, A.username).expect(201);
      await sendMessage(app, B, pid, 'hello A').expect(201);
      const shared = await call(mcpA, 'list_shared_projects');
      expect(shared.data.projects).toEqual([
        {
          project_id: pid,
          title: 'Shared with A',
          color: '#3366ff',
          owner_username: B.username,
        },
      ]);
      const msgs = await call(mcpA, 'list_chat_messages', { project_id: pid });
      expect(msgs.data.messages).toEqual([
        expect.objectContaining({
          author_username: B.username,
          body: 'hello A',
        }),
      ]);
      expect(JSON.stringify(msgs.data)).not.toContain(B.user_id);
      const unread = await call(mcpA, 'get_chat_unread');
      expect(unread.data).toEqual({
        items: [{ project_id: pid, unread_count: 1 }],
        total: 1,
      });
      const C = await signupAndLogin(app, 'mcpd');
      const mcpC = await connectMcp(base, (await createPat(app, C)).token);
      try {
        expect(
          await call(mcpC, 'list_chat_messages', { project_id: pid }),
        ).toMatchObject({
          isError: true,
          text: 'Project not found',
        });
      } finally {
        await mcpC.close();
      }
    });
  });
});

describe('MCP rate limit (FEAT-07a)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const limits = await chatTestLimits();
    app = await createTestApp({ ...limits, 'mcp-token-1m': { limit: 3 } });
    base = await listen(app);
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });

  it('per token: the 4th request in a minute is 429 with Retry-After; another token is unaffected', async () => {
    const A = await signupAndLogin(app, 'rla');
    const one = await createPat(app, A, { name: 'one' });
    const two = await createPat(app, A, { name: 'two' });
    const hit = (t: string) =>
      rawInitialize(base, { Authorization: `Bearer ${t}` });
    for (let i = 0; i < 3; i++) expect((await hit(one.token)).status).toBe(200);
    const blocked = await hit(one.token);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await hit(two.token)).status).toBe(200);
  });
});

describe('MCP assigning (FEAT-07e)', () => {
  let app: INestApplication;
  let base: string;
  let A: TestUser; // owner
  let B: TestUser; // member
  let C: TestUser; // outsider
  let mcpA: Client;
  let mcpB: Client;
  let mcpC: Client;
  let P: string;

  const assignments = async (u: TestUser) =>
    (
      await request(app.getHttpServer())
        .get('/api/notifications')
        .set(bearer(u))
    ).body.data.items.filter((n: { type: string }) => n.type === 'assignment');
  const assigneeOf = async (taskId: string) =>
    (
      await q<{ assignee_id: string | null }>(
        'SELECT "assignee_id" FROM "task_instance_entity" WHERE "task_id" = $1',
        [taskId],
      )
    )[0].assignee_id;
  const newTask = async (
    client: Client,
    title: string,
    extra: Record<string, unknown> = { project_id: P },
  ) => {
    const r = await call(client, 'create_task', { title, ...extra });
    expect(r.isError).toBe(false);
    return r.data.task.task_id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    base = await listen(app);
    A = await signupAndLogin(app, 'asga');
    B = await signupAndLogin(app, 'asgb');
    C = await signupAndLogin(app, 'asgc');
    P = await createProject(app, A, 'Assign here');
    await addMember(app, A, P, B.username).expect(201);
    mcpA = await connectMcp(base, (await createPat(app, A)).token);
    mcpB = await connectMcp(base, (await createPat(app, B)).token);
    mcpC = await connectMcp(base, (await createPat(app, C)).token);
  }, 60000);

  afterAll(async () => {
    await mcpA?.close();
    await mcpB?.close();
    await mcpC?.close();
    await app?.close();
  });

  it('1: list_project_members shows the owner and members, usernames only', async () => {
    const r = await call(mcpA, 'list_project_members', { project_id: P });
    expect(r.isError).toBe(false);
    expect(r.data).toEqual({
      owner: { user_id: A.user_id, username: A.username },
      members: [{ user_id: B.user_id, username: B.username }],
    });
    expect(JSON.stringify(r.data)).not.toMatch(/fullname|email|Test asg/);
    expect(r.text).toContain(`Owner ${A.username}, 1 member(s).`);
  });

  it('2: assign_task to a member sets the assignee and notifies them once', async () => {
    const t = await newTask(mcpA, 'Write the docs');
    const before = (await assignments(B)).length;
    const r = await call(mcpA, 'assign_task', {
      task_id: t,
      assignee: B.username,
    });
    expect(r.isError).toBe(false);
    expect(r.data.task.assignee_username).toBe(B.username);
    expect(r.text).toContain(`Assigned "Write the docs" to ${B.username}.`);
    expect(await assigneeOf(t)).toBe(B.user_id);
    await settle(200);
    expect((await assignments(B)).length).toBe(before + 1);
    // idempotent: the same assignee again sends nothing new
    await call(mcpA, 'assign_task', { task_id: t, assignee: B.username });
    expect((await assignments(B)).length).toBe(before + 1);
    // null unassigns
    const un = await call(mcpA, 'assign_task', { task_id: t, assignee: null });
    expect(un.isError).toBe(false);
    expect(un.data.task.assignee_username).toBeNull();
    expect(un.text).toBe(
      `Unassigned "Write the docs".\n${JSON.stringify(un.data)}`,
    );
    expect(await assigneeOf(t)).toBeNull();
  });

  it('3: a user outside the project is the not-a-member error, nothing changes', async () => {
    const t = await newTask(mcpA, 'Stay with A');
    for (const assignee of [C.username, 'nobody_here']) {
      const r = await call(mcpA, 'assign_task', { task_id: t, assignee });
      expect(r).toMatchObject({
        isError: true,
        text: 'Assignee must be a member of this project.',
      });
    }
    expect(await assigneeOf(t)).toBeNull();
    expect(await assignments(C)).toHaveLength(0);
  });

  it('4: a member assigns the owner\'s task to "me"', async () => {
    const t = await newTask(mcpA, 'B takes this');
    const r = await call(mcpB, 'assign_task', { task_id: t, assignee: 'me' });
    expect(r.isError).toBe(false);
    expect(r.data.task.assignee_username).toBe(B.username);
    expect(await assigneeOf(t)).toBe(B.user_id);
    // and the member may hand it to the owner by username
    const back = await call(mcpB, 'assign_task', {
      task_id: t,
      assignee: A.username,
    });
    expect(back.data.task.assignee_username).toBe(A.username);
  });

  it('5: a non-member cannot list the members or assign', async () => {
    expect(
      await call(mcpC, 'list_project_members', { project_id: P }),
    ).toMatchObject({ isError: true, text: 'Project not found' });
    const t = await newTask(mcpA, 'Not for C');
    expect(
      await call(mcpC, 'assign_task', { task_id: t, assignee: 'me' }),
    ).toMatchObject({ isError: true, text: 'Task not found' });
    expect(await assigneeOf(t)).toBeNull();
  });

  it('6: a task without a project cannot be assigned', async () => {
    const t = await newTask(mcpA, 'Personal', {});
    expect(
      await call(mcpA, 'assign_task', { task_id: t, assignee: 'me' }),
    ).toMatchObject({
      isError: true,
      text: 'Only a task in a project can be assigned.',
    });
    expect(
      await call(mcpA, 'create_task', { title: 'No project', assignee: 'me' }),
    ).toMatchObject({
      isError: true,
      text: 'Only a task in a project can be assigned.',
    });
  });

  it('7: create_task with an assignee creates and assigns, one notification', async () => {
    const before = (await assignments(B)).length;
    const r = await call(mcpA, 'create_task', {
      title: 'Born assigned',
      project_id: P,
      assignee: B.username,
    });
    expect(r.isError).toBe(false);
    expect(r.data.task.assignee_username).toBe(B.username);
    expect(r.text).toContain(`Created task "Born assigned" for ${B.username}.`);
    await settle(200);
    const after = await assignments(B);
    expect(after.length).toBe(before + 1);
    expect(after[0].message).toContain('Born assigned');
  });

  it('create_task: an unknown assignee or a recurring task creates nothing', async () => {
    const count = async () =>
      (
        await q<{ c: number }>(
          'SELECT count(*)::int AS c FROM "task_instance_entity" WHERE "title" = $1',
          ['Never made'],
        )
      )[0].c;
    expect(
      await call(mcpA, 'create_task', {
        title: 'Never made',
        project_id: P,
        assignee: C.username,
      }),
    ).toMatchObject({
      isError: true,
      text: 'Assignee must be a member of this project.',
    });
    expect(
      await call(mcpA, 'create_task', {
        title: 'Never made',
        project_id: P,
        assignee: 'me',
        is_recurring: true,
        repeat_every: 'Day',
        start_date: '2026-11-20',
      }),
    ).toMatchObject({
      isError: true,
      text: 'Recurring tasks start unassigned.',
    });
    expect(await count()).toBe(0);
  });
});
