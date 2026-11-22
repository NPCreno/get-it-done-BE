import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { CreateTaskDto } from './dto/create-task-dto';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskGeneratorService } from './taskGenerator.service';
import { UpdateTaskDto } from './dto/update-task-dto';
import { newTaskInstanceId, newTaskTemplateId } from './task-ids';
import {
  ASSIGN_NEEDS_PROJECT,
  MOVE_FORBIDDEN,
  RECURRING_NOT_ASSIGNABLE,
  rethrowAccess,
  TaskAccessService,
} from './task-access.service';
import { TaskAssignService } from './task-assign.service';
import { NotificationsEntity } from 'src/notifications/models/notifications.entity';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplateRepository: Repository<TaskTemplateEntity>,
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly taskGeneratorService: TaskGeneratorService,
    private readonly access: TaskAccessService,
    private readonly assign: TaskAssignService,
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

      // FEAT-09a: the owner or a member may add tasks to a project. A
      // stranger gets the same 404 as a missing project (no existence oracle).
      const project_id = taskDto?.project_id;
      if (project_id !== undefined && project_id !== null) {
        await this.access.assertCanUseProject(project_id, userId);
      }
      const assigneeId = taskDto.assignee_id ?? null;
      if (assigneeId !== null) {
        if (taskDto.isRecurring)
          throw new BadRequestException(RECURRING_NOT_ASSIGNABLE);
        if (!project_id) throw new BadRequestException(ASSIGN_NEEDS_PROJECT);
        await this.access.assertAssignable(project_id, assigneeId);
      }

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
        // REF-14b: a uuid id needs no "is it free" lookup; the unique
        // constraint is the final guard.
        const taskTemplate_id = newTaskTemplateId();
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
        this.assign.tasksChanged(project_id, userId);
        return {
          status: 'success',
          message: 'Recurring task created successfully',
          data: savedTaskTemplate,
        };
      } else {
        const task_id = newTaskInstanceId();
        // One transaction: the task and (D4) the assignee's notification.
        const { savedTask, notification } =
          await this.taskInstanceRepository.manager.transaction(
            async (manager) => {
              const saved = await manager.save(
                manager.create(TaskInstanceEntity, {
                  task_id,
                  title: taskDto.title,
                  description: taskDto.description,
                  priority: taskDto.priority,
                  status: taskDto.status,
                  due_date: taskDto.due_date,
                  user: { user_id: userId },
                  assignee_id: assigneeId,
                  ...(taskDto.project_id
                    ? { project: { project_id: taskDto.project_id } }
                    : {}),
                } as DeepPartial<TaskInstanceEntity>),
              );
              let notification: NotificationsEntity | null = null;
              if (assigneeId !== null && assigneeId !== userId)
                notification = await this.assign.notifyAssignment(manager, {
                  assigneeId,
                  actorId: userId,
                  taskId: task_id,
                  taskTitle: taskDto.title,
                  projectId: taskDto.project_id!,
                });
              return { savedTask: saved, notification };
            },
          );
        if (notification) this.assign.notificationCreated(notification);
        this.assign.tasksChanged(taskDto.project_id, userId);

        return {
          status: 'success',
          message: 'Task created successfully',
          data: savedTask,
        };
      }
    } catch (error: any) {
      rethrowAccess(error);
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
      // FEAT-09a D1: the creator, the project owner or a member.
      const task = await this.access.assertCanUseTask(task_id, tokenUserId);
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
      this.assign.tasksChanged(task.project_id, tokenUserId);
      return {
        status: 'success',
        message: 'Task updated successfully',
        data: updatedTask,
      };
    } catch (error: any) {
      rethrowAccess(error);
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
      // FEAT-09a D1: the project owner or the task's creator (403 otherwise).
      const task = await this.access.assertCanUseTask(task_id, tokenUserId);
      TaskAccessService.assertCanDelete(task);
      await this.taskInstanceRepository.softDelete({ task_id });
      this.assign.tasksChanged(task.project_id, tokenUserId);

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
      rethrowAccess(error);
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
    const access = await this.access.assertCanUseTask(task_id, tokenUserId, {
      withDeleted: true,
    });
    TaskAccessService.assertCanDelete(access);
    const task = await this.taskInstanceRepository.findOne({
      where: { task_id },
      relations: ['user'],
      withDeleted: true,
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.taskInstanceRepository.remove(task);
    this.assign.tasksChanged(access.project_id, tokenUserId);
    return task;
  }

  /**
   * Moves a task into a project, or out of any (null). FEAT-09a: only its
   * creator, into a project they own or are a member of; a move to another
   * project clears the assignee. A missing or foreign task or project is the
   * same 404; another member's task is 403.
   */
  async setProject(
    task_id: string,
    project_id: string | null,
    tokenUserId: string,
  ): Promise<void> {
    const task = await this.access.assertCanUseTask(task_id, tokenUserId);
    if (!task.isCreator) throw new ForbiddenException(MOVE_FORBIDDEN);
    if (project_id !== null)
      await this.access.assertCanUseProject(project_id, tokenUserId);
    const [, affected]: [unknown, number] =
      await this.taskInstanceRepository.query(
        `UPDATE "task_instance_entity"
            SET "assignee_id" = CASE WHEN "project_id" IS DISTINCT FROM $1
                                     THEN NULL ELSE "assignee_id" END,
                "project_id" = $1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "task_id" = $2 AND "user_id" = $3 AND "deletedAt" IS NULL`,
        [project_id, task_id, tokenUserId],
      );
    if (!affected) throw new NotFoundException('Task not found');
    this.assign.tasksChanged(task.project_id, tokenUserId);
    if (project_id !== task.project_id)
      this.assign.tasksChanged(project_id, tokenUserId);
  }
}
