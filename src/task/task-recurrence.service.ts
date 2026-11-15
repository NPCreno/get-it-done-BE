import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';

@Injectable()
export class TaskRecurrenceService {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
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
        select: ['id', 'taskTemplate_id', 'user_id'],
      });

      if (!template) {
        throw new NotFoundException(
          `Task template with ID ${taskTemplate_id} not found`,
        );
      }

      if (template.user_id !== tokenUserId) {
        throw new UnauthorizedException('Access denied: Not your data.');
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
