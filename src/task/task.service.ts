import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { CreateTaskDto } from './dto/create-task-dto';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { TaskGeneratorService } from './taskGenerator.service';
import { UpdateTaskDto } from './dto/update-task-dto';
import { newTaskInstanceId, newTaskTemplateId } from './task-ids';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplateRepository: Repository<TaskTemplateEntity>,
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    private readonly taskGeneratorService: TaskGeneratorService,
  ) {}

  async createBulkTasks(
    tasks: CreateTaskDto[],
    userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: (TaskInstanceEntity | TaskTemplateEntity)[];
    error?: any;
  }> {
    try {
      const results = [];
      const errors = [];

      for (const taskDto of tasks) {
        try {
          const result = await this.createTask(taskDto, userId);
          if (result.status === 'success' && result.data) {
            results.push(result.data);
          } else {
            errors.push({
              task: taskDto.title || 'Untitled Task',
              error: result.error || 'Failed to create task',
            });
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to create task';
          errors.push({
            task: taskDto.title || 'Untitled Task',
            error: errorMessage,
          });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        return {
          status: 'error',
          message: 'Failed to create any tasks',
          error: errors,
        };
      }

      return {
        status: 'success',
        message: `Successfully created ${results.length} task(s)${errors.length > 0 ? `, failed to create ${errors.length} task(s)` : ''}`,
        data: results,
        ...(errors.length > 0 && { error: errors }),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to process bulk task creation';
      return {
        status: 'error',
        message: 'Failed to process bulk task creation',
        error: errorMessage,
      };
    }
  }

  async createTask(
    taskDto: CreateTaskDto,
    userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity | TaskTemplateEntity;
    error?: any;
  }> {
    try {
      // identity comes from the token, never from the body
      const user_id = userId;
      const userExist = await this.usersRepository.findOne({
        where: { user_id },
      });
      if (!userExist) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      // find project_id
      const project_id = taskDto?.project_id;
      if (project_id !== undefined && project_id !== null) {
        const projectExists = await this.projectsRepository.findOne({
          where: { project_id },
        });
        // Same answer for "missing" and "someone else's": no existence oracle.
        if (!projectExists || projectExists.user_id !== userId) {
          throw new NotFoundException('Project not found');
        }
      }

      let task_id: string;
      let taskTemplate_id: string;
      let exists = true;
      if (taskDto.isRecurring) {
        if (!taskDto.repeat_every)
          throw new BadRequestException(
            'repeat_every is required for recurring tasks',
          );
        if (!taskDto.start_date)
          throw new BadRequestException(
            'start_date is required for recurring tasks',
          );
        if (
          taskDto.repeat_every === 'Week' &&
          (!taskDto.repeat_days || taskDto.repeat_days.length === 0)
        ) {
          throw new BadRequestException(
            'repeat days is required when repeat every is "Week"',
          );
        }
        do {
          taskTemplate_id = newTaskTemplateId();
          const existing = await this.taskTemplateRepository.findOne({
            where: { taskTemplate_id },
          });
          exists = !!existing;
        } while (exists);
        const {
          title,
          description,
          repeat_every,
          repeat_days,
          start_date,
          end_date,
        } = taskDto;

        const taskTemplate = this.taskTemplateRepository.create({
          taskTemplate_id,
          user_id: userId,
          title,
          description,
          repeat_every,
          repeat_days: repeat_every === 'Week' ? repeat_days : undefined,
          start_date,
          end_date,
          project_id,
        } as DeepPartial<TaskTemplateEntity>);

        const savedTaskTemplate =
          await this.taskTemplateRepository.save(taskTemplate);
        await this.taskGeneratorService.generateInstancesForCurrentMonth(); //trigger cronjob for generating task instances from task template
        return {
          status: 'success',
          message: 'Recurring task created successfully',
          data: savedTaskTemplate,
        };
      } else {
        do {
          // Generate unique task_id
          task_id = newTaskInstanceId();
          const existing = await this.taskInstanceRepository.findOne({
            where: { task_id },
          });
          exists = !!existing;
        } while (exists);

        const taskInstance = this.taskInstanceRepository.create({
          task_id,
          title: taskDto.title,
          description: taskDto.description,
          priority: taskDto.priority,
          status: taskDto.status,
          due_date: taskDto.due_date,
          user: { user_id: userId },
          ...(taskDto.project_id
            ? { project: { project_id: taskDto.project_id } }
            : {}),
        } as DeepPartial<TaskInstanceEntity>);

        const savedTask = await this.taskInstanceRepository.save(taskInstance);

        return {
          status: 'success',
          message: 'Task created successfully',
          data: savedTask,
        };
      }
    } catch (error: any) {
      console.error('Error creating task:', error);
      return {
        status: 'error',
        message: 'Failed to create task',
        error: error?.message || error,
      };
    }
  }

  async updateOne(
    task_id: string,
    updateTaskDto: UpdateTaskDto,
    tokenUserId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity;
    error?: any;
  }> {
    try {
      const task = await this.taskInstanceRepository.findOne({
        where: { task_id },
        relations: ['user', 'project'],
        select: {
          id: true,
          task_id: true,
          project: {
            project_id: true,
          },
          user: {
            user_id: true,
          },
        },
      });
      if (!task) {
        throw new NotFoundException(`Task with ID ${task_id} not found`);
      }
      if (tokenUserId !== task.user.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
      const changes: Record<string, unknown> = {};
      for (const key of [
        'title',
        'description',
        'priority',
        'status',
        'due_date',
      ] as const) {
        if (updateTaskDto[key] !== undefined) changes[key] = updateTaskDto[key];
      }
      if (Object.keys(changes).length > 0) {
        await this.taskInstanceRepository.update({ task_id }, changes);
      }
      const updatedTask = await this.taskInstanceRepository.findOne({
        where: { task_id },
      });
      if (!updatedTask) throw new NotFoundException(`Updated task not found`);
      return {
        status: 'success',
        message: 'Task updated successfully',
        data: updatedTask,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to update task',
        error: error?.message || error,
      };
    }
  }

  async softDeleteOne(
    task_id: string,
    tokenUserId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity | null;
    error?: any;
  }> {
    try {
      const task = await this.taskInstanceRepository.findOne({
        where: { task_id },
        relations: ['user', 'project'],
        select: {
          id: true,
          task_id: true,
          project: {
            project_id: true,
          },
          user: {
            user_id: true,
          },
        },
      });
      if (!task)
        throw new NotFoundException(`Task with ID ${task_id} not found`);
      if (tokenUserId !== task.user.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
      await this.taskInstanceRepository.softDelete({ task_id });

      const deletedTask = await this.taskInstanceRepository.findOne({
        where: { task_id },
        withDeleted: true,
      });

      return {
        status: 'success',
        message: 'Task deleted successfully',
        data: deletedTask,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to delete task',
        error: error?.message || error,
      };
    }
  }

  async hardDeleteOne(
    task_id: string,
    tokenUserId: string,
  ): Promise<TaskInstanceEntity> {
    const task = await this.taskInstanceRepository.findOne({
      where: { task_id },
      relations: ['user'],
      withDeleted: true,
    });
    if (!task) {
      throw new NotFoundException(`task with ID ${task_id} not found`);
    }
    if (tokenUserId !== task.user.user_id) {
      throw new UnauthorizedException('Access denied: Not your data.');
    }
    await this.taskInstanceRepository.remove(task);
    return task;
  }

  /**
   * Moves the caller's task into one of their projects, or out of any
   * (null). A missing or foreign task or project is the same 404.
   */
  async setProject(
    task_id: string,
    project_id: string | null,
    tokenUserId: string,
  ): Promise<void> {
    if (project_id !== null) {
      const project = await this.projectsRepository.findOne({
        where: { project_id },
      });
      if (!project || project.user_id !== tokenUserId)
        throw new NotFoundException('Project not found');
    }
    const [, affected]: [unknown, number] =
      await this.taskInstanceRepository.query(
        `UPDATE "task_instance_entity"
            SET "project_id" = $1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "task_id" = $2 AND "user_id" = $3 AND "deletedAt" IS NULL`,
        [project_id, task_id, tokenUserId],
      );
    if (!affected) throw new NotFoundException('Task not found');
  }
}
