import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  rethrowAccess,
  SUBTASK_NOT_FOUND,
  TaskAccessService,
} from './task-access.service';
import { TaskAssignService } from './task-assign.service';

@Injectable()
export class TaskStatusService {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly access: TaskAccessService,
    private readonly assign: TaskAssignService,
  ) {}

  /**
   * FEAT-09a: anyone who can edit the task sets its status (D1). A completion
   * credits the responsible person, COALESCE(assignee_id, user_id), read in
   * the same UPDATE: their lifetime counter and their `task.completed` awards
   * (D2), not the caller's.
   */
  async updateTaskStatus(task_id: string, status: string, user_id: string) {
    try {
      const task = await this.access.assertCanUseTask(task_id, user_id);

      // One transaction: conditional status change + lifetime counter. The
      // users row lock serialises concurrent completions of the same user.
      let lifetimeCount: number | null = null;
      let responsible: string | null = null;
      const changed = await this.taskInstanceRepository.manager.transaction(
        async (manager) => {
          const updated: unknown = await manager.query(
            `UPDATE "task_instance_entity"
               SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
             WHERE "task_id" = $2 AND "status" IS DISTINCT FROM $1
               AND "deletedAt" IS NULL
             RETURNING "id", COALESCE("assignee_id", "user_id") AS "responsible"`,
            [status, task_id],
          );
          // pg driver: UPDATE ... RETURNING yields [rows, affected]
          const rows = (
            Array.isArray((updated as unknown[])[0])
              ? (updated as unknown[][])[0]
              : updated
          ) as { responsible: string }[];
          if (rows.length === 0) return false;
          responsible = rows[0].responsible;
          if (status === 'Complete') {
            const bumped: unknown = await manager.query(
              `UPDATE "users"
                  SET "lifetime_completed_count" = "lifetime_completed_count" + 1
                WHERE "user_id" = $1
                RETURNING "lifetime_completed_count" AS "count"`,
              [responsible],
            );
            const bumpedRows = (
              Array.isArray((bumped as unknown[])[0])
                ? (bumped as unknown[][])[0]
                : bumped
            ) as { count: number }[];
            lifetimeCount = Number(bumpedRows[0].count);
          }
          return true;
        },
      );

      // Emit after commit so the listener sees the committed state
      if (changed) {
        this.logger.log(`Task ${task_id} status changed to '${status}'`);
        if (
          status === 'Complete' &&
          lifetimeCount !== null &&
          responsible !== null
        ) {
          this.eventEmitter.emit('task.completed', {
            userId: responsible,
            taskId: task.task_id,
            lifetimeCount,
          });
        }
        this.assign.tasksChanged(task.project_id, user_id);
        return {
          status: 'success',
          message: `Task updated to ${status} successfully`,
        };
      } else {
        return {
          status: 'success',
          message: `Task status already set to '${status}', no change needed`,
        };
      }
    } catch (error: any) {
      rethrowAccess(error);
      this.logger.error(
        `Failed to update task ${task_id} status: ${error.message}`,
        error.stack,
      );
      return {
        status: 'error',
        message: 'Failed to update task status',
        error: error?.message || error,
      };
    }
  }

  async updateSubTaskStatus(
    taskSubInstance_id: string,
    status: string,
    user_id: string,
  ) {
    try {
      const subTask = await this.taskSubInstanceRepository.findOne({
        where: { taskSubInstance_id },
        relations: ['instance'],
        select: {
          id: true,
          taskSubInstance_id: true,
          title: true,
          instance: { id: true, task_id: true },
          status: true,
        },
      });
      const taskId = subTask?.instance?.task_id;
      if (!subTask || !taskId) throw new NotFoundException(SUBTASK_NOT_FOUND);
      // FEAT-09a D1: anyone who can edit the parent task. A stranger gets the
      // same 404 as a missing sub-task.
      const parent = await this.access
        .assertCanUseTask(taskId, user_id)
        .catch(() => {
          throw new NotFoundException(SUBTASK_NOT_FOUND);
        });

      // Log the status change
      if (subTask.status !== status) {
        this.logger.log(
          `SubTask ${taskSubInstance_id} (${subTask.title || 'No title'}) status changing from '${subTask.status}' to '${status}'`,
        );
        if (status === 'Complete') {
          this.logger.log(`Marking subTask ${taskSubInstance_id} as Complete`);
        }
      } else {
        this.logger.debug(
          `SubTask ${taskSubInstance_id} status already set to '${status}', no change needed`,
        );
      }

      await this.taskSubInstanceRepository.update(
        { taskSubInstance_id },
        { status: status as 'Complete' | 'Pending' | 'Overdue' },
      );

      this.assign.tasksChanged(parent.project_id, user_id);
      return {
        status: 'success',
        message: `SubTask updated to ${status} successfully`,
      };
    } catch (error: any) {
      rethrowAccess(error);
      this.logger.error(
        `Failed to update subTask ${taskSubInstance_id} status: ${error.message}`,
        error.stack,
      );
      return {
        status: 'error',
        message: 'Failed to update subTask status',
        error: error?.message || error,
      };
    }
  }
}
