import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DELETE_FORBIDDEN,
  decideTaskAccess,
  rethrowAccess,
  TASK_NOT_FOUND,
  TaskAccessService,
} from './task-access.service';
import { accessibleTo, myTasks, responsibleSql } from './task-scope';
import { assignmentMessage, tasksEventRecipients } from './task-events';

/** FEAT-09a §1: every row of the access table. */
const row = (o: {
  creator?: string;
  project?: string | null;
  owner?: string | null;
  deleted?: boolean;
  member?: boolean;
}) => ({
  creator_id: o.creator ?? 'c',
  project_id: o.project === undefined ? 'PRJ-1' : o.project,
  owner_id: o.owner === undefined ? 'o' : o.owner,
  project_deleted: o.deleted ?? false,
  is_member: o.member ?? false,
});

const notFound = (f: () => unknown) => {
  expect(f).toThrow(NotFoundException);
  expect(f).toThrow(TASK_NOT_FOUND);
};

describe('decideTaskAccess (FEAT-09a)', () => {
  it('no project: the creator may edit and delete', () => {
    expect(decideTaskAccess(row({ project: null, owner: null }), 'c')).toEqual({
      canEdit: true,
      canDelete: true,
      isProjectOwner: false,
      isCreator: true,
    });
  });

  it('no project: anyone else is 404, even a "member" flag', () => {
    notFound(() =>
      decideTaskAccess(row({ project: null, owner: null, member: true }), 'x'),
    );
  });

  it('project owner: edit and delete any task, also in a deleted project', () => {
    for (const deleted of [false, true])
      expect(decideTaskAccess(row({ deleted }), 'o')).toEqual({
        canEdit: true,
        canDelete: true,
        isProjectOwner: true,
        isCreator: false,
      });
  });

  it('member: edits any task, deletes only their own', () => {
    expect(decideTaskAccess(row({ member: true }), 'm')).toEqual({
      canEdit: true,
      canDelete: false,
      isProjectOwner: false,
      isCreator: false,
    });
    expect(
      decideTaskAccess(row({ member: true, creator: 'm' }), 'm'),
    ).toMatchObject({ canEdit: true, canDelete: true, isCreator: true });
  });

  it('member of a soft-deleted project: 404', () => {
    notFound(() => decideTaskAccess(row({ member: true, deleted: true }), 'm'));
  });

  it('a removed member who created the task: 404', () => {
    notFound(() => decideTaskAccess(row({ creator: 'm' }), 'm'));
  });

  it('stranger, missing task, missing owner, empty user: 404', () => {
    notFound(() => decideTaskAccess(row({}), 's'));
    notFound(() => decideTaskAccess(undefined, 's'));
    notFound(() => decideTaskAccess(row({ owner: null }), 'c'));
    notFound(() => decideTaskAccess(row({ creator: '' }), ''));
  });

  it('assertCanDelete is 403 with the fixed message', () => {
    const access = decideTaskAccess(row({ member: true }), 'm');
    expect(() => TaskAccessService.assertCanDelete(access)).toThrow(
      new ForbiddenException(DELETE_FORBIDDEN),
    );
  });

  it('rethrowAccess passes access errors on and swallows others', () => {
    expect(() => rethrowAccess(new NotFoundException(TASK_NOT_FOUND))).toThrow(
      NotFoundException,
    );
    expect(() =>
      rethrowAccess(new ForbiddenException(DELETE_FORBIDDEN)),
    ).toThrow(ForbiddenException);
    expect(() =>
      rethrowAccess(new NotFoundException('User with ID x not found')),
    ).not.toThrow();
    expect(() => rethrowAccess(new Error(TASK_NOT_FOUND))).not.toThrow();
  });
});

describe('task scope SQL (FEAT-09a)', () => {
  it('responsible is exactly the index expression', () => {
    expect(responsibleSql('t')).toBe(
      'COALESCE("t"."assignee_id", "t"."user_id")',
    );
  });

  it('myTasks = responsible AND accessible, one bound parameter', () => {
    const sql = myTasks('t');
    expect(
      sql.startsWith('COALESCE("t"."assignee_id", "t"."user_id") = :uid AND '),
    ).toBe(true);
    expect(sql).toContain(accessibleTo('t'));
    expect(sql.match(/:\w+/g)!.every((p) => p === ':uid')).toBe(true);
  });

  it('accessible: creator without project, owner, live member', () => {
    const sql = accessibleTo('task', 'me');
    expect(sql).toContain(
      '"task"."project_id" IS NULL AND "task"."user_id" = :me',
    );
    expect(sql).toContain('"ap"."user_id" = :me');
    expect(sql).toContain('"ap"."deletedAt" IS NULL AND EXISTS');
    expect(sql).toContain('"am"."user_id" = :me');
  });
});

describe('tasks event recipients (FEAT-09a D3)', () => {
  it('owner and members minus the actor, each once', () => {
    expect(tasksEventRecipients('o', ['a', 'b', 'a'], 'a')).toEqual(['o', 'b']);
  });

  it('the owner alone in a project with no members tells nobody', () => {
    expect(tasksEventRecipients('o', [], 'o')).toEqual([]);
  });

  it('a removed member is told too, but never the actor', () => {
    expect(tasksEventRecipients('o', ['b'], 'o', ['r'])).toEqual(['b', 'r']);
    expect(tasksEventRecipients('o', [], 'r', ['r'])).toEqual(['o']);
  });

  it('a missing project tells only alsoNotify', () => {
    expect(tasksEventRecipients(null, [], 'o', ['r', ''])).toEqual(['r']);
  });
});

describe('assignment message (FEAT-09a D4)', () => {
  it('names the actor, the task and the project', () => {
    expect(assignmentMessage('alice', 'Write docs', 'Launch')).toBe(
      'alice assigned you "Write docs" in Launch',
    );
  });

  it('cuts the task title at 80 characters', () => {
    const msg = assignmentMessage('a', 'x'.repeat(100), 'P');
    const title = msg.match(/"(.*)"/)![1];
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
    expect(assignmentMessage('a', 'y'.repeat(80), 'P')).toContain(
      `"${'y'.repeat(80)}"`,
    );
  });

  it('an untitled project gets a label', () => {
    expect(assignmentMessage('a', 'T', null)).toBe(
      'a assigned you "T" in Untitled Project',
    );
  });
});
