import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { NotificationsEntity } from 'src/notifications/models/notifications.entity';
import { newId } from 'src/common/ids';
import { ASSIGN_NEEDS_PROJECT, TaskAccessService } from './task-access.service';
import { TaskQueryService } from './task-query.service';
import { TaskInstanceResponse } from './interfaces/taskInstanceResponse';
import {
  ASSIGNMENT_TITLE,
  assignmentMessage,
  NOTIFICATION_CREATED,
  NotificationCreatedEvent,
  TASKS_CHANGED,
  TasksChangedEvent,
} from './task-events';

/**
 * FEAT-09a assignment (D1, D4) and the two after-commit events every task
 * write sends (D3).
 */
@Injectable()
export class TaskAssignService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: TaskAccessService,
    private readonly query: TaskQueryService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Anyone who can edit the task sets or clears its assignee. The task must
   * be in a project and the assignee its owner or a current member. A real
   * change to someone other than the actor gets an `assignment` notification
   * in the same transaction; unassigning and "no change" send none.
   */
  async setAssignee(
    taskId: string,
    assigneeId: string | null,
    actorId: string,
  ): Promise<TaskInstanceResponse> {
    const { projectId, changed, notification } =
      await this.dataSource.transaction(async (manager) => {
        const task = await this.access.assertCanUseTask(taskId, actorId, {
          manager,
        });
        if (!task.project_id)
          throw new BadRequestException(ASSIGN_NEEDS_PROJECT);
        if (assigneeId !== null)
          await this.access.assertAssignable(
            task.project_id,
            assigneeId,
            manager,
          );
        const [rows]: [unknown[], number] = await manager.query(
          `UPDATE "task_instance_entity"
              SET "assignee_id" = $1, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "task_id" = $2 AND "deletedAt" IS NULL
              AND "assignee_id" IS DISTINCT FROM $1
           RETURNING "task_id"`,
          [assigneeId, taskId],
        );
        const changed = rows.length > 0;
        const notification =
          changed && assigneeId !== null && assigneeId !== actorId
            ? await this.notifyAssignment(manager, {
                assigneeId,
                actorId,
                taskId,
                taskTitle: task.title,
                projectId: task.project_id,
              })
            : null;
        return { projectId: task.project_id, changed, notification };
      });
    if (notification) this.notificationCreated(notification);
    if (changed) this.tasksChanged(projectId, actorId);
    return this.query.taskRow(taskId, actorId);
  }

  /** Inserts the D4 notification inside the caller's transaction. */
  async notifyAssignment(
    manager: EntityManager,
    a: {
      assigneeId: string;
      actorId: string;
      taskId: string;
      taskTitle: string;
      projectId: string;
    },
  ): Promise<NotificationsEntity> {
    const [names]: { actor: string | null; project: string | null }[] =
      await manager.query(
        `SELECT (SELECT "username" FROM "users" WHERE "user_id" = $1) AS "actor",
                (SELECT "title" FROM "project_entity" WHERE "project_id" = $2) AS "project"`,
        [a.actorId, a.projectId],
      );
    const notification = manager.create(NotificationsEntity, {
      notif_id: newId('notif'),
      user: { user_id: a.assigneeId },
      type: 'assignment',
      title: ASSIGNMENT_TITLE,
      message: assignmentMessage(
        names?.actor ?? 'Someone',
        a.taskTitle,
        names?.project ?? null,
      ),
      read: false,
      actionType: 'acknowledge',
      actionTarget: '/projects',
      metadata: { taskId: a.taskId, projectId: a.projectId },
    } as DeepPartial<NotificationsEntity>);
    return manager.save(notification);
  }

  /** After the commit: push the committed notification on its user's stream. */
  notificationCreated(notification: NotificationsEntity): void {
    const userId = (notification.user as { user_id: string }).user_id;
    this.events.emit(NOTIFICATION_CREATED, {
      userId,
      notification,
    } satisfies NotificationCreatedEvent);
  }

  /** After the commit: the D3 `tasks` event, for a task with a project only. */
  tasksChanged(
    projectId: string | null | undefined,
    actorId: string,
    alsoNotify?: string[],
  ): void {
    if (!projectId) return;
    this.events.emit(TASKS_CHANGED, {
      projectId,
      actorId,
      alsoNotify,
    } satisfies TasksChangedEvent);
  }
}
