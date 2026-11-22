import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import {
  DELETE_FORBIDDEN,
  rethrowAccess,
  TASK_NOT_FOUND,
} from './task-access.service';
import { TaskAssignService } from './task-assign.service';

@Injectable()
export class TaskRecurrenceService {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    private readonly assign: TaskAssignService,
  ) {}

  async deleteRecurringTasks(
    taskTemplate_id: string,
    tokenUserId: string,
    includeCompleted: boolean,
  ): Promise<{
    status: string;
    message: string;
    data?: {
      deletedInstances: TaskInstanceEntity[];
      deletedTemplate: TaskTemplateEntity | null;
    } | null;
    error?: any;
  }> {
    const queryRunner =
      this.taskInstanceRepository.manager.connection.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Get the template with required fields in a single query
      const template = await queryRunner.manager.findOne(TaskTemplateEntity, {
        where: { taskTemplate_id },
        select: ['id', 'taskTemplate_id', 'user_id', 'project_id'],
      });

      if (!template) {
        throw new NotFoundException(
          `Task template with ID ${taskTemplate_id} not found`,
        );
      }

      // FEAT-09a: the template's creator or the project owner. A member gets
      // 403, a stranger the same 404 as a missing task.
      if (template.user_id !== tokenUserId) {
        const [p]: { owner_id: string; is_member: boolean }[] =
          template.project_id
            ? await queryRunner.manager.query(
                `SELECT p."user_id" AS "owner_id",
                        (p."deletedAt" IS NULL AND EXISTS (
                          SELECT 1 FROM "project_members" m
                           WHERE m."project_id" = p."project_id"
                             AND m."user_id" = $2)) AS "is_member"
                   FROM "project_entity" p WHERE p."project_id" = $1`,
                [template.project_id, tokenUserId],
              )
            : [];
        if (p?.owner_id !== tokenUserId) {
          if (p?.is_member) throw new ForbiddenException(DELETE_FORBIDDEN);
          throw new NotFoundException(TASK_NOT_FOUND);
        }
      }

      this.logger.debug(
        `Deleting tasks for template ${taskTemplate_id}, includeCompleted: ${includeCompleted}`,
      );

      // Get all tasks for this template
      const allTasks = await queryRunner.manager.find(TaskInstanceEntity, {
        where: { template: { id: template.id } },
        select: ['id', 'task_id', 'status', 'title', 'due_date'],
        withDeleted: false,
      });

      this.logger.debug(
        `Found ${allTasks.length} total tasks for template ${taskTemplate_id}`,
      );

      let deletedInstances: TaskInstanceEntity[] = [];

      if (includeCompleted) {
        // Delete all instances - template deletion with SET NULL will handle this automatically
        deletedInstances = allTasks;
        this.logger.debug(
          `Will delete all ${allTasks.length} tasks along with template`,
        );
      } else {
        // Only delete non-completed tasks manually
        const tasksToDelete = allTasks.filter(
          (task) => task.status !== 'Complete',
        );
        const tasksToKeep = allTasks.filter(
          (task) => task.status === 'Complete',
        );

        this.logger.debug(
          `Will delete ${tasksToDelete.length} non-completed tasks, keeping ${tasksToKeep.length} completed tasks`,
        );

        if (tasksToDelete.length > 0) {
          // Delete non-completed tasks first
          await queryRunner.manager.delete(TaskInstanceEntity, {
            id: In(tasksToDelete.map((t) => t.id)),
          });
          this.logger.debug(
            `Successfully deleted ${tasksToDelete.length} non-completed tasks`,
          );
        }

        deletedInstances = tasksToDelete;
      }

      // Delete the template
      // With SET NULL constraint:
      // - If includeCompleted=true: remaining instances (if any) will have template set to null
      // - If includeCompleted=false: completed tasks will have template set to null and become standalone
      const deleteResult = await queryRunner.manager.delete(
        TaskTemplateEntity,
        { taskTemplate_id },
      );

      if (deleteResult.affected === 0) {
        throw new Error(`Failed to delete template ${taskTemplate_id}`);
      }

      this.logger.debug(`Successfully deleted template ${taskTemplate_id}`);

      // Commit the transaction
      await queryRunner.commitTransaction();
      this.assign.tasksChanged(template.project_id, tokenUserId);

      const keptCount = allTasks.length - deletedInstances.length;
      return {
        status: 'success',
        message: `Successfully deleted ${deletedInstances.length} task instances and the task template${keptCount > 0 ? ` (${keptCount} completed tasks converted to standalone)` : ''}`,
        data: {
          deletedInstances,
          deletedTemplate: template,
        },
      };
    } catch (error: any) {
      this.logger.error('Error in deleteRecurringTasks:', error);
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
          this.logger.debug('Transaction rolled back successfully');
        } catch (rollbackError) {
          this.logger.error('Failed to rollback transaction', rollbackError);
        }
      }
      rethrowAccess(error);

      return {
        status: 'error',
        message: 'Failed to delete recurring tasks',
        error: error?.message || 'An unexpected error occurred',
      };
    } finally {
      try {
        if (queryRunner.isReleased === false) {
          await queryRunner.release();
        }
      } catch (releaseError) {
        this.logger.error('Failed to release query runner', releaseError);
      }
    }
  }
}
