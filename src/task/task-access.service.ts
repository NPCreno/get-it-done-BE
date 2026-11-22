import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  ChatAccess,
  ChatAccessService,
  PROJECT_NOT_FOUND,
} from 'src/chat/chat-access.service';

export const TASK_NOT_FOUND = 'Task not found';
export const DELETE_FORBIDDEN =
  "Only the project owner or the task's creator can delete it.";
export const MOVE_FORBIDDEN = "Only the task's creator can move it.";
export const ASSIGNEE_NOT_MEMBER = 'Assignee must be a member of this project.';
export const ASSIGN_NEEDS_PROJECT = 'Only a task in a project can be assigned.';
export const RECURRING_NOT_ASSIGNABLE = 'A recurring task cannot be assigned.';
export const SUBTASK_NOT_FOUND = 'Subtask not found';
export const SUBTASK_DELETE_FORBIDDEN =
  "Only the project owner, the task's creator or the sub-task's creator can delete it.";

/** Answers these services give as real HTTP errors, even on envelope routes. */
const ACCESS_MESSAGES = new Set<string>([
  TASK_NOT_FOUND,
  PROJECT_NOT_FOUND,
  DELETE_FORBIDDEN,
  MOVE_FORBIDDEN,
  ASSIGNEE_NOT_MEMBER,
  ASSIGN_NEEDS_PROJECT,
  RECURRING_NOT_ASSIGNABLE,
  SUBTASK_NOT_FOUND,
  SUBTASK_DELETE_FORBIDDEN,
]);

/**
 * Envelope routes (`{status: 'error'}` on 200) still answer access problems
 * with their status: 404 for a stranger, 403 for a member's forbidden delete,
 * 400 for a bad assignee. Call first thing in their `catch`.
 */
export function rethrowAccess(error: unknown): void {
  if (error instanceof HttpException && ACCESS_MESSAGES.has(error.message))
    throw error;
}

/** What one query knows about a task and the viewer (FEAT-09a). */
export interface TaskAccessRow {
  task_id: string;
  title: string;
  creator_id: string;
  assignee_id: string | null;
  project_id: string | null;
  owner_id: string | null;
  project_deleted: boolean;
  is_member: boolean;
}

export interface TaskAccess {
  canEdit: boolean;
  canDelete: boolean;
  isProjectOwner: boolean;
  isCreator: boolean;
}

/**
 * Pure decision, unit tested. No project: only the creator. In a project: the
 * owner (even when the project is soft-deleted, as before), or a current
 * member while it is not deleted. Everyone else gets the same 404 as a missing
 * task. Editing (add, edit, assign, complete) is open to everyone allowed;
 * deleting to the owner and the creator.
 */
export function decideTaskAccess(
  row: Omit<TaskAccessRow, 'task_id' | 'title' | 'assignee_id'> | undefined,
  userId: string,
): TaskAccess {
  if (!row || typeof userId !== 'string' || userId === '')
    throw new NotFoundException(TASK_NOT_FOUND);
  const isCreator = row.creator_id === userId;
  if (row.project_id === null) {
    if (!isCreator) throw new NotFoundException(TASK_NOT_FOUND);
    return {
      canEdit: true,
      canDelete: true,
      isProjectOwner: false,
      isCreator,
    };
  }
  if (!row.owner_id) throw new NotFoundException(TASK_NOT_FOUND);
  const isProjectOwner = row.owner_id === userId;
  const isLiveMember = !row.project_deleted && row.is_member === true;
  if (!isProjectOwner && !isLiveMember)
    throw new NotFoundException(TASK_NOT_FOUND);
  return {
    canEdit: true,
    canDelete: isProjectOwner || isCreator,
    isProjectOwner,
    isCreator,
  };
}

/** The one access check for tasks (FEAT-09a). */
@Injectable()
export class TaskAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly chatAccess: ChatAccessService,
  ) {}

  /** One SQL; throws 404 for a missing, deleted or foreign task. */
  async assertCanUseTask(
    taskId: string,
    userId: string,
    opts: { withDeleted?: boolean; manager?: EntityManager } = {},
  ): Promise<TaskAccess & TaskAccessRow> {
    const manager = opts.manager ?? this.dataSource.manager;
    const rows: TaskAccessRow[] = await manager.query(
      `SELECT t."task_id", t."title", t."user_id" AS "creator_id",
              t."assignee_id", t."project_id",
              p."user_id" AS "owner_id",
              (p."deletedAt" IS NOT NULL) AS "project_deleted",
              EXISTS (SELECT 1 FROM "project_members" m
                       WHERE m."project_id" = t."project_id"
                         AND m."user_id" = $2) AS "is_member"
         FROM "task_instance_entity" t
         LEFT JOIN "project_entity" p ON p."project_id" = t."project_id"
        WHERE t."task_id" = $1
          ${opts.withDeleted ? '' : 'AND t."deletedAt" IS NULL'}`,
      [taskId, userId],
    );
    const row = rows[0];
    return { ...row, ...decideTaskAccess(row, userId) };
  }

  /** Owner or member of a live project; a stranger gets 404 (ChatAccessService). */
  assertCanUseProject(
    projectId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ChatAccess> {
    return this.chatAccess.assertCanChat(projectId, userId, manager);
  }

  /** The assignee is the project's owner or a current member, and not deleted. */
  async assertAssignable(
    projectId: string,
    assigneeId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const rows: unknown[] = await manager.query(
      `SELECT 1
         FROM "project_entity" p
         JOIN "users" u ON u."user_id" = $2 AND u."deletedAt" IS NULL
        WHERE p."project_id" = $1
          AND (p."user_id" = $2 OR EXISTS (
            SELECT 1 FROM "project_members" m
             WHERE m."project_id" = p."project_id" AND m."user_id" = $2))`,
      [projectId, assigneeId],
    );
    if (rows.length === 0) throw new BadRequestException(ASSIGNEE_NOT_MEMBER);
  }

  /** Throws 403 unless the access allows a delete. */
  static assertCanDelete(access: TaskAccess): void {
    if (!access.canDelete) throw new ForbiddenException(DELETE_FORBIDDEN);
  }
}
