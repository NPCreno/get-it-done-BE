/**
 * REF-13: counts are SQL aggregates. Query-count and semantics tests over a
 * crafted dataset; every expected number is written by hand from the dataset.
 * Run with `npm run db:up && npm run test:int`.
 */
import { API_TEST_DB, BASE_URL } from './int-env';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { createTestApp } from './int-app';
import { signupAndLogin, TestUser } from './int-auth';
import { queryDb } from './int-db';
import { TaskService } from '../src/task/task.service';
import { UserEntity } from '../src/user/models/user.entity';

const q = (sql: string, params: unknown[] = []) =>
  queryDb(BASE_URL, API_TEST_DB, sql, params);

// Window under test and month under test (the test process runs with TZ=UTC).
const START = '2030-06-10T00:00:00.000Z';
const END = '2030-06-11T00:00:00.000Z';
const MONTH = '06';
const YEAR = '2030';

describe('SQL counts (REF-13)', () => {
  let app: INestApplication;
  let svc: TaskService;
  let A: TestUser;
  let B: TestUser;
  let calls: { sql: string; params: unknown[] }[] = [];
  let spy: jest.SpyInstance;

  const proj = (
    id: string,
    user: string,
    title: string | null,
    color: string | null,
    created: string,
    deleted: string | null = null,
  ) =>
    q(
      `INSERT INTO project_entity (project_id, user_id, title, color, "createdAt", "updatedAt", "deletedAt")
       VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [id, user, title, color, created, deleted],
    );

  const task = (
    id: string,
    user: string,
    status: string,
    due: string | null,
    opts: { project?: string; updated?: string; deleted?: string } = {},
  ) =>
    q(
      `INSERT INTO task_instance_entity (task_id, user_id, project_id, title, priority, status, due_date, "createdAt", "updatedAt", "deletedAt")
       VALUES ($1,$2,$3,$1,'Low',$4,$5,'2030-01-01',$6,$7)`,
      [
        id,
        user,
        opts.project ?? null,
        status,
        due,
        opts.updated ?? '2030-01-02',
        opts.deleted ?? null,
      ],
    );

  const counted = async <T>(fn: () => Promise<T>) => {
    calls = [];
    const out = await fn();
    return { out, calls: [...calls] };
  };

  beforeAll(async () => {
    app = await createTestApp();
    svc = app.get(TaskService);
    A = await signupAndLogin(app, 'a');
    B = await signupAndLogin(app, 'b');

    // A's projects. Alpha id < Beta id (insert order).
    await proj('PRJ-A1', A.user_id, 'Alpha', '#111111', '2030-05-01');
    await proj('PRJ-A2', A.user_id, null, null, '2030-06-05'); // untitled
    await proj(
      'PRJ-A3',
      A.user_id,
      'Gamma',
      '#333333',
      '2030-05-01',
      '2030-06-15',
    ); // deleted mid-month
    await proj('PRJ-A4', A.user_id, 'Late', '#444444', '2030-07-02'); // after month end
    await proj(
      'PRJ-A5',
      A.user_id,
      'Old',
      '#555555',
      '2030-04-01',
      '2030-05-20',
    ); // deleted before month
    await proj('PRJ-B1', B.user_id, 'Bravo', '#bbbbbb', '2030-05-01');

    const U = A.user_id;
    await task('t1', U, 'Pending', null, { project: 'PRJ-A1' });
    await task('t2', U, 'Complete', null, { updated: '2030-05-15' }); // no project
    await task('t3', U, 'Pending', '2030-06-10T12:00:00Z', {
      project: 'PRJ-A1',
    });
    await task('t4', U, 'Complete', '2030-06-10T13:00:00Z', {
      project: 'PRJ-A1',
      updated: '2030-06-10T13:00:00Z',
    });
    await task('t5', U, 'Overdue', '2030-06-10T14:00:00Z', {
      project: 'PRJ-A1',
    });
    await task('t6', U, 'Pending', '2030-06-01T00:00:00Z', {
      project: 'PRJ-A1',
    }); // overdue
    await task('t7', U, 'Pending', '2030-07-01T00:00:00Z', {
      project: 'PRJ-A1',
    }); // future
    await task('t8', U, 'Complete', '2030-07-01T00:00:00Z', {
      project: 'PRJ-A1',
      updated: '2030-07-02',
    });
    await task('t9', U, 'Complete', null, {
      project: 'PRJ-A1',
      updated: '2030-06-12',
      deleted: '2030-06-13',
    });
    await task('t10', U, 'Pending', '2030-06-10T15:00:00Z', {
      project: 'PRJ-A1',
      deleted: '2030-06-13',
    });
    await task('t11', U, 'Pending', START); // exactly start
    await task('t12', U, 'Pending', END); // exactly end
    await task('t13', U, 'Complete', '2030-08-01', {
      project: 'PRJ-A1',
      updated: '2030-06-01T00:00:00Z', // exactly start of month
    });
    await task('t14', U, 'Complete', '2030-08-01', {
      project: 'PRJ-A1',
      updated: '2030-06-30T23:59:59Z', // exactly end of month
    });
    // Beta (untitled): only a soft-deleted completed task in the month.
    await task('t15', U, 'Complete', '2030-08-01', {
      project: 'PRJ-A2',
      updated: '2030-06-10',
      deleted: '2030-06-11',
    });
    // t4 has two subtasks: no row multiplication.
    for (const n of [1, 2]) {
      await q(
        `INSERT INTO task_sub_instance_entity ("taskSubInstance_id", user_id, task_id, title, status, "createdAt", "updatedAt")
         VALUES ($1,$2,'t4','s','Pending','2030-01-01','2030-01-01')`,
        [`sub${n}`, U],
      );
    }
    // B's data must never count for A.
    await task('b1', B.user_id, 'Complete', null, {
      project: 'PRJ-B1',
      updated: '2030-06-10',
    });
    await task('b2', B.user_id, 'Pending', '2030-06-10T12:00:00Z', {
      project: 'PRJ-B1',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = PostgresQueryRunner.prototype.query;
    spy = jest
      .spyOn(PostgresQueryRunner.prototype, 'query')
      .mockImplementation(function (this: PostgresQueryRunner, ...args) {
        calls.push({
          sql: String(args[0]),
          params: (args[1] as unknown[]) ?? [],
        });
        return original.apply(this, args);
      });
  }, 60000);

  afterAll(async () => {
    spy?.mockRestore();
    await app?.close();
  });

  it('Q0: the spy counts queries', async () => {
    const users = app.get(getRepositoryToken(UserEntity));
    const { calls: c } = await counted(() =>
      users.findOne({ where: { user_id: A.user_id } }),
    );
    expect(c).toHaveLength(1);
  });

  it('Q1/C1: countCompletedTasks is one join-free query', async () => {
    const { out, calls: c } = await counted(() =>
      svc.countCompletedTasks(A.user_id),
    );
    expect(out).toBe(5); // t2, t4, t8, t13, t14; t9/t15 soft-deleted
    expect(c).toHaveLength(1);
    expect(c[0].sql).not.toMatch(/join/i);
    expect(c[0].sql).toMatch(/"user_id" = \$\d/);
    expect(c[0].sql).toMatch(/"status" = \$\d/);
    expect(c[0].sql).toMatch(/"deletedAt" IS NULL/);
    expect(c[0].params).toEqual(
      expect.arrayContaining([A.user_id, 'Complete']),
    );
  });

  it('C1b: soft-deleting a completed task lowers the count by one', async () => {
    await q(
      `UPDATE task_instance_entity SET "deletedAt" = now() WHERE task_id = 't14'`,
    );
    expect(await svc.countCompletedTasks(A.user_id)).toBe(4);
    await q(
      `UPDATE task_instance_entity SET "deletedAt" = NULL WHERE task_id = 't14'`,
    );
    expect(await svc.countCompletedTasks(A.user_id)).toBe(5);
  });

  it('Q2/C2: dashboard with a window is 3 queries with exact counts', async () => {
    const { out, calls: c } = await counted(() =>
      svc.getDashboardData(A.user_id, START, END),
    );
    expect(c).toHaveLength(3);
    expect(out).toEqual({
      status: 'success',
      message: 'Dashboard data fetched successfully',
      data: {
        all_tasks: 8, // null-due 2 + in-window 3 + overdue 1 + both boundaries
        pending_tasks: 5, // t1, t3, t6, t11, t12 (Overdue status excluded)
        complete_tasks: 5,
        all_projects: 3, // A1, A2, A4 (A3 and A5 soft-deleted)
      },
    });
  });

  it('C3: dashboard without dates counts only null-due tasks in the window', async () => {
    const out = await svc.getDashboardData(A.user_id);
    expect(out.data).toMatchObject({
      all_tasks: 2, // t1, t2
      pending_tasks: 1, // t1
      complete_tasks: 5,
    });
  });

  it('C4: missing and soft-deleted users get the error envelope', async () => {
    const miss = await svc.getDashboardData('nope', START, END);
    expect(miss).toMatchObject({
      status: 'error',
      message: 'Failed to fetch dashboard data',
    });
    await q(`UPDATE users SET "deletedAt" = now() WHERE user_id = $1`, [
      B.user_id,
    ]);
    const del = await svc.getDashboardData(B.user_id, START, END);
    expect(del.status).toBe('error');
    await q(`UPDATE users SET "deletedAt" = NULL WHERE user_id = $1`, [
      B.user_id,
    ]);
  });

  it('Q3/C5/C6: distribution is 2 queries, ordered, with exact values', async () => {
    const { out, calls: c } = await counted(() =>
      svc.getTaskDistribution(A.user_id, MONTH, YEAR),
    );
    expect(c).toHaveLength(2);
    expect(out.data).toEqual([
      // Alpha: t4, t13 (exact month start), t14 (exact month end).
      { title: 'Alpha', value: 3, fill: '#111111' },
      // Untitled: only a soft-deleted task, so 0, still listed.
      { title: 'Untitled Project', value: 0, fill: '#808080' },
    ]);
    // Excluded: Gamma (deleted mid-month), Late (after month end), Old, B's.
  });
});
