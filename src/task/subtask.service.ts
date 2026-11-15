import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { CreateTaskSubInstanceDto } from './dto/create-task-subInstance-dto';
import { newTaskSubInstanceId } from './task-ids';

@Injectable()
export class SubTaskService {
  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
  ) {}

  private async validateParentTask(
    taskId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const parentTask = await this.taskInstanceRepository.findOne({
        where: { task_id: taskId, user: { user_id: userId } },
      });
      return !!parentTask;
    } catch {
      return false;
    }
  }

  async createBulkTaskSubInstances(
    createBulkDto: CreateTaskSubInstanceDto[],
    userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity[];
    error?: any;
  }> {
    try {
      const results = [];
      const errors = [];
      const taskValidations = new Map<string, boolean>();

      // Ensure subtasks array exists and is an array
      if (!Array.isArray(createBulkDto)) {
        return {
          status: 'error',
          message: 'Invalid subtasks data',
          error: 'Expected an array of subtasks',
        };
      }

      // First pass: validate all parent tasks
      for (const subTaskDto of createBulkDto) {
        // Skip validation if we've already checked this task
        if (taskValidations.has(subTaskDto.task_id)) {
          continue;
        }

        const isValid = await this.validateParentTask(
          subTaskDto.task_id,
          userId,
        );
        taskValidations.set(subTaskDto.task_id, isValid);
      }

      // Second pass: create subtasks with validated parent tasks
      for (const subTaskDto of createBulkDto) {
        const isParentValid = taskValidations.get(subTaskDto.task_id);
        if (!isParentValid) {
          errors.push({
            subTask: subTaskDto.title || 'Untitled Sub-Task',
            error: `Parent task with ID ${subTaskDto.task_id} not found or access denied`,
            taskId: subTaskDto.task_id,
          });
          continue;
        }

        try {
          const result = await this.createTaskSubInstance(subTaskDto, userId);
          if (result.status === 'success' && result.data) {
            results.push(result.data);
          } else {
            errors.push({
              subTask: subTaskDto.title || 'Untitled Sub-Task',
              error: result.error || 'Failed to create sub-task',
              taskId: subTaskDto.task_id,
            });
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Failed to create sub-task';
          errors.push({
            subTask: subTaskDto.title || 'Untitled Sub-Task',
            error: errorMessage,
            taskId: subTaskDto.task_id,
          });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        return {
          status: 'error',
          message: 'Failed to create any sub-tasks',
          error: errors,
        };
      }

      return {
        status: 'success',
        message: `Successfully created ${results.length} sub-task(s)${errors.length > 0 ? `, failed to create ${errors.length} sub-task(s)` : ''}`,
        data: results,
        ...(errors.length > 0 && { error: errors }),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to process bulk sub-task creation';
      return {
        status: 'error',
        message: 'Failed to process bulk sub-task creation',
        error: errorMessage,
      };
    }
  }

  async createTaskSubInstance(
    createDto: CreateTaskSubInstanceDto,
    userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity;
    error?: any;
  }> {
    try {
      // Verify the parent task exists and belongs to the user
      const parentTask = await this.taskInstanceRepository.findOne({
        where: { task_id: createDto.task_id, user: { user_id: userId } },
      });

      if (!parentTask) {
        throw new NotFoundException(
          `Task with ID ${createDto.task_id} not found or access denied`,
        );
      }

      // Generate unique ID for the sub-instance
      let taskSubInstanceId: string;
      let exists = true;
      do {
        taskSubInstanceId = newTaskSubInstanceId();
        const existing = await this.taskSubInstanceRepository.findOne({
          where: { taskSubInstance_id: taskSubInstanceId },
        });
        exists = !!existing;
      } while (exists);

      // Create and save the sub-instance
      const subInstance = this.taskSubInstanceRepository.create({
        taskSubInstance_id: taskSubInstanceId,
        title: createDto.title,
        status: createDto.status,
        due_date: createDto.due_date ? new Date(createDto.due_date) : null,
        user: { user_id: userId } as UserEntity,
        instance: { task_id: createDto.task_id } as TaskInstanceEntity,
      } as DeepPartial<TaskSubInstanceEntity>);

      const savedSubInstance =
        await this.taskSubInstanceRepository.save(subInstance);

      return {
        status: 'success',
        message: 'Task sub-instance created successfully',
        data: savedSubInstance,
      };
    } catch (error: any) {
      console.error('Error creating task sub-instance:', error);
      return {
        status: 'error',
        message: 'Failed to create task sub-instance',
        error: error?.message || error,
      };
    }
  }

  async softDeleteSubTask(
    taskSubInstance_id: string,
    tokenUserId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity | null;
    error?: any;
  }> {
    try {
      const subTask = await this.taskSubInstanceRepository.findOne({
        where: { taskSubInstance_id },
        relations: ['user', 'instance'],
        select: {
          id: true,
          taskSubInstance_id: true,
          user: {
            user_id: true,
          },
          instance: {
            task_id: true,
          },
        },
      });
      if (!subTask)
        throw new NotFoundException(
          `SubTask with ID ${taskSubInstance_id} not found`,
        );
      if (tokenUserId !== subTask.user.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
      await this.taskSubInstanceRepository.softDelete({ taskSubInstance_id });

      const deletedSubTask = await this.taskSubInstanceRepository.findOne({
        where: { taskSubInstance_id },
        withDeleted: true,
      });

      return {
        status: 'success',
        message: 'SubTask deleted successfully',
        data: deletedSubTask,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to delete task',
        error: error?.message || error,
      };
    }
  }
}
