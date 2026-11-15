import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TaskStatusService {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async updateTaskStatus(task_id: string, status: string, user_id: string) {
    try {
      const task = await this.taskInstanceRepository.findOne({
        where: { task_id },
        relations: ['user'],
        select: {
          id: true,
          task_id: true,
          user: {
            user_id: true,
          },
          status: true,
        },
      });

      if (!task) {
        this.logger.warn(`Task with ID ${task_id} not found`);
        throw new NotFoundException(`Task with ID ${task_id} not found`);
      }

      if (user_id !== task.user.user_id) {
        this.logger.warn(
          `Unauthorized status update attempt for task ${task_id} by user ${user_id}`,
        );
        throw new UnauthorizedException('Access denied: Not your data.');
      }

      // Log the status change
      if (task.status !== status) {
        this.logger.log(
          `Task ${task_id} (${task.title || 'No title'}) status changing from '${task.status}' to '${status}'`,
        );
        if (status === 'Complete') {
          this.logger.log(`Marking task ${task_id} as Complete`);
        }
      } else {
        this.logger.debug(
          `Task ${task_id} status already set to '${status}', no change needed`,
        );
      }

      // One transaction: conditional status change + lifetime counter. The
      // users row lock serialises concurrent completions of the same user.
      let lifetimeCount: number | null = null;
      const changed = await this.taskInstanceRepository.manager.transaction(
        async (manager) => {
          const updated: unknown = await manager.query(
            `UPDATE "task_instance_entity"
               SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
             WHERE "task_id" = $2 AND "status" IS DISTINCT FROM $1
             RETURNING "id"`,
            [status, task_id],
          );
          // pg driver: UPDATE ... RETURNING yields [rows, affected]
          const rows = (
            Array.isArray((updated as unknown[])[0])
              ? (updated as unknown[][])[0]
              : updated
          ) as unknown[];
          if (rows.length === 0) return false;
          if (status === 'Complete') {
            const bumped: unknown = await manager.query(
              `UPDATE "users"
                  SET "lifetime_completed_count" = "lifetime_completed_count" + 1
                WHERE "user_id" = $1
                RETURNING "lifetime_completed_count" AS "count"`,
              [task.user.user_id],
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
        if (status === 'Complete' && lifetimeCount !== null) {
          this.logger.log(
            `Successfully updated task ${task_id} status to '${status}'`,
          );
          this.eventEmitter.emit('task.completed', {
            userId: task.user.user_id,
            taskId: task.task_id,
            lifetimeCount,
          });
        }
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
        relations: ['user'],
        select: {
          id: true,
          taskSubInstance_id: true,
          user: {
            user_id: true,
          },
          status: true,
        },
      });

      if (!subTask) {
        this.logger.warn(`SubTask with ID ${taskSubInstance_id} not found`);
        throw new NotFoundException(
          `SubTask with ID ${taskSubInstance_id} not found`,
        );
      }

      if (user_id !== subTask.user.user_id) {
        this.logger.warn(
          `Unauthorized status update attempt for subTask ${taskSubInstance_id} by user ${user_id}`,
        );
        throw new UnauthorizedException('Access denied: Not your data.');
      }

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

      this.logger.log(
        `Successfully updated subTask ${taskSubInstance_id} status to '${status}'`,
      );
      return {
        status: 'success',
        message: `SubTask updated to ${status} successfully`,
      };
    } catch (error: any) {
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
