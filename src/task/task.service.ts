import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { 
  Between, 
  In, 
  IsNull, 
  LessThan, 
  MoreThanOrEqual, 
  Repository 
} from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { CreateBulkTasksDto, CreateTaskDto } from './dto/create-task-dto';
import { DeepPartial } from 'typeorm';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { TaskGeneratorService } from './taskGenerator.service';
import { OnModuleInit } from '@nestjs/common';
import { UpdateTaskDto } from './dto/update-task-dto';
import { IDashboardData } from './interfaces/dashboardData';
import { TaskCompletionTrend } from './interfaces/taskCompletionTrend';
import { TaskDistribution } from './interfaces/taskDistribution';
import { TaskInstanceResponse } from './interfaces/taskInstanceResponse';
import { CalendarHeatmap } from './interfaces/calendarHeatmap';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { CreateBulkSubTasksDto, CreateTaskSubInstanceDto } from './dto/create-task-subInstance-dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TaskService implements OnModuleInit {
  private readonly logger = new Logger('TaskService');

  constructor(
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplateRepository: Repository<TaskTemplateEntity>,
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @Inject(forwardRef(() => TaskGeneratorService))
    private readonly taskGeneratorService: TaskGeneratorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
  async onModuleInit() {
    await this.taskGeneratorService.generateInstancesForCurrentMonth(); //trigger cronjob for generating task instances from task template
  }

  private generateTaskInstanceId(): string {
    const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
    return 'task-' + randomNumber.toString().padStart(9, '0');
  }

  private generateTaskTemplateId(): string {
    return `TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private generateTaskSubInstanceId(): string {
    return `subTask-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  async countCompletedTasks(user_id: string): Promise<number> {
    try {
      const user = await this.usersRepository.findOne({ where: { user_id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }
      
      const data = await this.taskInstanceRepository.find({
        where: {user: { user_id }},
        relations: ['user', 'project', 'template', 'subInstances'],
        withDeleted: false,
      });
      const completedTasks = data.filter((task) => task.status === 'Complete');
      return completedTasks.length;
      
    } catch (error: any) {
      this.logger.error(`Failed to count completed tasks for user ${user_id}: ${error.message}`);
      throw error;
    }
  }
  

  async createBulkTasks(tasks: CreateBulkTasksDto, userId: string): Promise<{
    status: string;
    message: string;
    data?: (TaskInstanceEntity | TaskTemplateEntity)[];
    error?: any;
  }> {
    try {
      const results = [];
      const errors = [];

      for (const taskDto of tasks) {
        if (taskDto.user_id !== userId) {
          errors.push({ 
            task: taskDto.title || 'Untitled Task',
            error: 'User ID mismatch' 
          });
          continue;
        }

        try {
          const result = await this.createTask(taskDto);
          if (result.status === 'success' && result.data) {
            results.push(result.data);
          } else {
            errors.push({
              task: taskDto.title || 'Untitled Task',
              error: result.error || 'Failed to create task'
            });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create task';
          errors.push({
            task: taskDto.title || 'Untitled Task',
            error: errorMessage
          });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        return {
          status: 'error',
          message: 'Failed to create any tasks',
          error: errors
        };
      }

      return {
        status: 'success',
        message: `Successfully created ${results.length} task(s)${errors.length > 0 ? `, failed to create ${errors.length} task(s)` : ''}`,
        data: results,
        ...(errors.length > 0 && { error: errors })
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process bulk task creation';
      return {
        status: 'error',
        message: 'Failed to process bulk task creation',
        error: errorMessage
      };
    }
  }

  async createTask(taskDto: CreateTaskDto): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity | TaskTemplateEntity;
    error?: any;
  }> {
    try {
      // find user_id
      const user_id = taskDto.user_id;
      const userExist = await this.usersRepository.findOne({
        where: { user_id },
      });
      if (!userExist) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      // find project_id
      const project_id = taskDto?.project_id;
      if(project_id !== undefined){
        const projectExists = await this.projectsRepository.findOne({
          where: { project_id },
        });
        if (!projectExists) {
          throw new NotFoundException(`Project with ID ${project_id} not found`);
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
          taskTemplate_id = this.generateTaskTemplateId();
          const existing = await this.taskTemplateRepository.findOne({
            where: { taskTemplate_id },
          });
          exists = !!existing;
        } while (exists);
        const {
          user_id,
          title,
          description,
          repeat_every,
          repeat_days,
          start_date,
          end_date,
          project_id,
        } = taskDto;

        const taskTemplate = this.taskTemplateRepository.create({
          taskTemplate_id,
          user_id,
          title,
          description,
          repeat_every,
          repeat_days,
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
          task_id = this.generateTaskInstanceId();
          const existing = await this.taskInstanceRepository.findOne({
            where: { task_id },
          });
          exists = !!existing;
        } while (exists);

        // Create and save the new project
        let taskInstance: TaskInstanceEntity;
        if (taskDto.project_id) {
          taskInstance = this.taskInstanceRepository.create({
            ...taskDto,
            priority: taskDto.priority as 'Low' | 'Medium' | 'High',
            status: taskDto.status as 'Pending' | 'Complete',
            project: { project_id: taskDto.project_id }, // link project by project_id
            user: { user_id: taskDto.user_id }, // link user by user_id
            task_id,
          });
        } else {
          taskInstance = this.taskInstanceRepository.create({
            ...taskDto,
            priority: taskDto.priority as 'Low' | 'Medium' | 'High',
            status: taskDto.status as 'Pending' | 'Complete',
            user: { user_id: taskDto.user_id }, // link user by user_id
            task_id,
          });
        }

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

  private async validateParentTask(taskId: string, userId: string): Promise<boolean> {
    try {
      const parentTask = await this.taskInstanceRepository.findOne({
        where: { task_id: taskId, user: { user_id: userId } },
      });
      return !!parentTask;
    } catch (error) {
      return false;
    }
  }

  async createBulkTaskSubInstances(createBulkDto: CreateBulkSubTasksDto, userId: string): Promise<{
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
          error: 'Expected an array of subtasks'
        };
      }

      // First pass: validate all parent tasks
      for (const subTaskDto of createBulkDto) {
        if (subTaskDto.user_id !== userId) {
          errors.push({
            subTask: subTaskDto.title || 'Untitled Sub-Task',
            error: 'User ID mismatch',
            taskId: subTaskDto.task_id
          });
          continue;
        }

        // Skip validation if we've already checked this task
        if (taskValidations.has(subTaskDto.task_id)) {
          continue;
        }

        const isValid = await this.validateParentTask(subTaskDto.task_id, userId);
        taskValidations.set(subTaskDto.task_id, isValid);
      }

      // Second pass: create subtasks with validated parent tasks
      for (const subTaskDto of createBulkDto) {
        // Skip if user ID was invalid
        if (subTaskDto.user_id !== userId) continue;

        const isParentValid = taskValidations.get(subTaskDto.task_id);
        if (!isParentValid) {
          errors.push({
            subTask: subTaskDto.title || 'Untitled Sub-Task',
            error: `Parent task with ID ${subTaskDto.task_id} not found or access denied`,
            taskId: subTaskDto.task_id
          });
          continue;
        }

        try {
          const result = await this.createTaskSubInstance(subTaskDto);
          if (result.status === 'success' && result.data) {
            results.push(result.data);
          } else {
            errors.push({
              subTask: subTaskDto.title || 'Untitled Sub-Task',
              error: result.error || 'Failed to create sub-task',
              taskId: subTaskDto.task_id
            });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create sub-task';
          errors.push({
            subTask: subTaskDto.title || 'Untitled Sub-Task',
            error: errorMessage,
            taskId: subTaskDto.task_id
          });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        return {
          status: 'error',
          message: 'Failed to create any sub-tasks',
          error: errors
        };
      }

      return {
        status: 'success',
        message: `Successfully created ${results.length} sub-task(s)${errors.length > 0 ? `, failed to create ${errors.length} sub-task(s)` : ''}`,
        data: results,
        ...(errors.length > 0 && { error: errors })
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process bulk sub-task creation';
      return {
        status: 'error',
        message: 'Failed to process bulk sub-task creation',
        error: errorMessage
      };
    }
  }

  async createTaskSubInstance(
    createDto: CreateTaskSubInstanceDto,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity;
    error?: any;
  }> {
    try {
      // Verify the parent task exists and belongs to the user
      const parentTask = await this.taskInstanceRepository.findOne({
        where: { task_id: createDto.task_id, user: { user_id: createDto.user_id } },
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
        taskSubInstanceId = this.generateTaskSubInstanceId();
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
        user: { user_id: createDto.user_id } as UserEntity,
        instance: { task_id: createDto.task_id } as TaskInstanceEntity,
      } as DeepPartial<TaskSubInstanceEntity>);

      const savedSubInstance = await this.taskSubInstanceRepository.save(subInstance);

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

  async getTasksByUser(
    user_id: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceResponse[];
    error?: string;
  }> {
    try {
      const user = await this.usersRepository.findOne({ where: { user_id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${user_id} not found`);
    }

    const where: any[] = [
      { user: { user_id }, due_date: IsNull() },
    ];
    
    if (startDate && endDate) {
      where.push({
        user: { user_id },
        due_date: Between(new Date(startDate), new Date(endDate)),
      });
    
      // also include overdue tasks (missed deadlines)
      where.push({
        user: { user_id },
        due_date: LessThan(new Date(startDate)),
      });
    }
    

    const data = await this.taskInstanceRepository.find({
      where,
      relations: ['user', 'project', 'template', 'subInstances'],
      withDeleted: false,
    });

    if (data.length === 0) {
      throw new NotFoundException(`No tasks found for user ID ${user_id}`);
    }

    // Get all task IDs to fetch their sub-instances in a single query
    const taskIds = data.map(task => task.task_id);
    const allSubInstances = await this.taskSubInstanceRepository.find({
      where: {
        instance: {
          task_id: In(taskIds)
        }
      },
      relations: ['instance'],  // Include the instance relation
      order: {
        createdAt: 'ASC'
      }
    });

    // Group sub-instances by task_id
    const subInstancesByTaskId = allSubInstances.reduce((acc, subInstance) => {
      // Safely access task_id with optional chaining
      const taskId = subInstance.instance?.task_id;
      if (!taskId) return acc;  // Skip if no task_id found
      
      if (!acc[taskId]) {
        acc[taskId] = [];
      }
      acc[taskId].push({
        id: subInstance.id,
        taskSubInstance_id: subInstance.taskSubInstance_id,
        title: subInstance.title,
        status: subInstance.status,
        due_date: subInstance.due_date,
        createdAt: subInstance.createdAt,
        updatedAt: subInstance.updatedAt
      });
      return acc;
    }, {} as Record<string, any[]>);

    const sortedData = data
      .map(({ user, project, template, ...rest }) => ({
        ...rest,
        user_id: user.user_id,
        project_title: project?.title ?? null,
        template_id: template?.taskTemplate_id ?? null,
        subInstances: subInstancesByTaskId[rest.task_id] || []
      }))
      .sort((a, b) => {
        if (a.status === "Complete" && b.status !== "Complete") return 1;
        if (a.status !== "Complete" && b.status === "Complete") return -1;
        return 0;
      });

      return {
        status: 'success',
        message: 'Tasks fetched successfully',
        data: sortedData,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch tasks',
        error: error?.message || error,
      };
    }
  }

  async getTasksByProj(
    tokenUserId: string,
    project_id: string,
    startDate?: string,
    endDate?: string,
  ): Promise<any[]> {
    try {
      const project = await this.projectsRepository.findOne({
        where: { project_id },
      });
      if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
      }
      if (tokenUserId !== project.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
      const where: any[] = [{ project: { project_id }, due_date: IsNull() }];
      if (startDate && endDate) {
        where.push({
          project: { project_id },
          due_date: Between(new Date(startDate), new Date(endDate)),
        });
      }

      const data = await this.taskInstanceRepository.find({
        where,
        relations: ['project'],
        withDeleted: false,
      });

      return data
      .map(({ project, ...rest }) => ({
        ...rest,
        project_id: project.project_id,
      }))
      .sort((a, b) => {
        if (a.status === "Complete" && b.status !== "Complete") return 1;
        if (a.status !== "Complete" && b.status === "Complete") return -1;
        return 0;
      });
    } catch (error: any) {
      console.error(`Error fetching tasks for project ${project_id}:`, error);
      return []; // Return empty array on error
    }
  }

  async updateOne(
    task_id: string,
    updateTaskDto: UpdateTaskDto,
    tokenUserId: string,
  ): Promise<
    {
    status: string;
    message: string;
    data?: TaskInstanceEntity;
    error?: any;
    }
  > {
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
          }
        }
      });
    if (!task) {
      throw new NotFoundException(`Task with ID ${task_id} not found`);
    }
    if (tokenUserId !== task.user.user_id) {
      throw new UnauthorizedException('Access denied: Not your data.');
    }
    await this.taskInstanceRepository.update({ task_id }, updateTaskDto);
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
    }}

  async softDeleteOne(task_id: string, tokenUserId: string): Promise<{
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
          }
        }
      });
      if (!task) throw new NotFoundException(`Task with ID ${task_id} not found`);
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

  async softDeleteSubTask(taskSubInstance_id: string, tokenUserId: string): Promise<{
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
          }
        }
      });
      if (!subTask) throw new NotFoundException(`SubTask with ID ${taskSubInstance_id} not found`);
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


  async deleteRecurringTasks(taskTemplate_id: string, tokenUserId: string, includeCompleted: boolean): Promise<{
    status: string;
    message: string;
    data?: {
      deletedInstances: TaskInstanceEntity[];
      deletedTemplate: TaskTemplateEntity | null;
    } | null;
    error?: any;
  }> {
    const queryRunner = this.taskInstanceRepository.manager.connection.createQueryRunner();
    
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      
      // Get the template with required fields in a single query
      const template = await queryRunner.manager.findOne(TaskTemplateEntity, {
        where: { taskTemplate_id },
        select: ['id', 'taskTemplate_id', 'user_id']
      });
  
      if (!template) {
        throw new NotFoundException(`Task template with ID ${taskTemplate_id} not found`);
      }
  
      if (template.user_id !== tokenUserId) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
  
      this.logger.debug(`Deleting tasks for template ${taskTemplate_id}, includeCompleted: ${includeCompleted}`);
      
      // Get all tasks for this template
      const allTasks = await queryRunner.manager.find(TaskInstanceEntity, {
        where: { template: { id: template.id } },
        select: ['id', 'task_id', 'status', 'title', 'due_date'],
        withDeleted: false
      });
      
      this.logger.debug(`Found ${allTasks.length} total tasks for template ${taskTemplate_id}`);
      
      let deletedInstances: TaskInstanceEntity[] = [];
      
      if (includeCompleted) {
        // Delete all instances - template deletion with SET NULL will handle this automatically
        deletedInstances = allTasks;
        this.logger.debug(`Will delete all ${allTasks.length} tasks along with template`);
      } else {
        // Only delete non-completed tasks manually
        const tasksToDelete = allTasks.filter(task => task.status !== 'Complete');
        const tasksToKeep = allTasks.filter(task => task.status === 'Complete');
        
        this.logger.debug(`Will delete ${tasksToDelete.length} non-completed tasks, keeping ${tasksToKeep.length} completed tasks`);
        
        if (tasksToDelete.length > 0) {
          // Delete non-completed tasks first
          await queryRunner.manager.delete(TaskInstanceEntity, {
            id: In(tasksToDelete.map(t => t.id))
          });
          this.logger.debug(`Successfully deleted ${tasksToDelete.length} non-completed tasks`);
        }
        
        deletedInstances = tasksToDelete;
      }
  
      // Delete the template 
      // With SET NULL constraint:
      // - If includeCompleted=true: remaining instances (if any) will have template set to null
      // - If includeCompleted=false: completed tasks will have template set to null and become standalone
      const deleteResult = await queryRunner.manager.delete(TaskTemplateEntity, { taskTemplate_id });
      
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
          deletedTemplate: template
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

  async hardDeleteOne(task_id: string, tokenUserId: string): Promise<TaskInstanceEntity> {
    const task = await this.taskInstanceRepository.findOne({
      where: { task_id },
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

  async getDashboardData(
    user_id: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    status: string;
    message: string;
    data?: IDashboardData;
    error?: string;
  }> {
    try {
      const user = await this.usersRepository.findOne({ where: { user_id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      const where: any[] = [
        { user: { user_id }, due_date: IsNull() },
      ];
      
      if (startDate && endDate) {
        where.push({
          user: { user_id },
          due_date: Between(new Date(startDate), new Date(endDate)),
        });
      
        // also include overdue tasks (missed deadlines)
        where.push({
          user: { user_id },
          due_date: LessThan(new Date(startDate)),
        });
      }

      const projects = await this.projectsRepository.find({
        where: { user: { user_id } },
        relations: ['user'],
        withDeleted: false,
      });

      const data = await this.taskInstanceRepository.find({
        where,
        relations: ['user', 'project'],
        withDeleted: false,
      });

      const pendingTasks = data.filter(task => task.status === 'Pending');
      const completeTasks = await this.countCompletedTasks(user_id);

      return {
        status: 'success',
        message: 'Dashboard data fetched successfully',
        data: {
          all_tasks: data.length,
          pending_tasks: pendingTasks.length,
          complete_tasks: completeTasks,
          all_projects: projects.length,
        },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch dashboard data',
        error: error.message || error,
      };
    }
  }

  async getTaskCompletionTrend(
    user_id: string, 
    startDate: string, 
    endDate: string
  ): Promise<{
    status: string;
    message: string;
    data?: TaskCompletionTrend[];
    error?: string;
  }> {
    try {
      // Validate user exists
      const user = await this.usersRepository.findOne({ where: { user_id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      // Parse dates and set proper time boundaries in local timezone
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      // Fetch completed tasks within the date range
      const tasks = await this.taskInstanceRepository.find({
        where: {
          user: { user_id },
          status: 'Complete',
          updatedAt: Between(start, end)
        },
        order: {
          updatedAt: 'ASC'
        }
      });

      // Initialize a map for all dates in the range with 0 counts
      const dateMap = new Map<string, { completed: number; day: string }>();
      const currentDate = new Date(start);
      
      // Initialize all dates in range with 0 counts and day names
      while (currentDate <= end) {
        // Format date as YYYY-MM-DD in local time
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        // Get day name in user's locale
        const dayOfWeek = currentDate.toLocaleDateString('en-US', { 
          weekday: 'short'
        });
        
        dateMap.set(dateStr, { completed: 0, day: dayOfWeek });
        
        // Move to the next day in local time
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Count completed tasks by date
      tasks.forEach(task => {
        if (task.updatedAt) {
          // Convert task date to local date string for consistent comparison
          const taskDate = new Date(task.updatedAt);
          const year = taskDate.getFullYear();
          const month = String(taskDate.getMonth() + 1).padStart(2, '0');
          const day = String(taskDate.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          
          const dateData = dateMap.get(dateStr);
          if (dateData) {
            dateMap.set(dateStr, {
              ...dateData,
              completed: dateData.completed + 1
            });
          }
        }
      });

      // Convert map to array of TaskCompletionTrend
      const result = Array.from(dateMap.entries())
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, { completed, day }]) => ({
          date,
          day,
          completed
        }));

      return {
        status: 'success',
        message: 'Task completion trend retrieved successfully',
        data: result
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch task completion trend',
        error: error.message || error,
      };
    }
  }

  async getTaskDistribution(
    user_id: string,
    month: string,
    year: string
  ): Promise<{
    status: string;
    message: string;
    data?: TaskDistribution[];
    error?: string;
  }> {
    try {
      const user = await this.usersRepository.findOne({ where: { user_id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      // Create date objects for the start and end of the target month
      const targetDate = new Date(`${year}-${month}-01`);
      const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59);

      // Fetch projects with their completed tasks for the target month
      const projects = await this.projectsRepository
        .createQueryBuilder('project')
        .leftJoinAndSelect(
          'project.taskInstances', 
          'task',
          'task.status = :status AND task.updatedAt BETWEEN :startOfMonth AND :endOfMonth',
          { 
            status: 'Complete',
            startOfMonth,
            endOfMonth 
          }
        )
        .where('project.user_id = :user_id', { user_id })
        .andWhere('project.createdAt <= :endOfMonth', { endOfMonth })
        .andWhere('(project.deletedAt IS NULL OR project.deletedAt >= :startOfMonth)', { startOfMonth })
        .select([
          'project.id',
          'project.project_id',
          'project.title',
          'project.color',
          'task.id', // Only select task.id for counting
          'task.status'
        ])
        .getMany();

      // Transform projects to match the TaskDistribution interface
      const distributionData = projects.map(project => ({
        title: project.title || 'Untitled Project',
        value: project.taskInstances?.filter(task => task.status === 'Complete').length || 0,
        fill: project.color || '#808080', // Default to gray if no color is set
      }));

      return {
        status: 'success',
        message: 'Task distribution retrieved successfully',
        data: distributionData,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch project distribution',
        error: error.message || error,
      };
    }
  }

  async getCalendarHeatmap(
    user_id: string,
    month: string,
    year: string
  ): Promise<{
    status: string;
    message: string;
    data?: CalendarHeatmap[];
    error?: string;
  }> {
    try {
      const user = await this.usersRepository.findOne({ where: { user_id } });
      if (!user) {
        throw new NotFoundException(`User with ID ${user_id} not found`);
      }

      // Create date objects for the start and end of the target month
      const targetDate = new Date(`${year}-${month}-01`);
      const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59);

      // Fetch all completed tasks for the user in the target month
      const completedTasks = await this.taskInstanceRepository
        .createQueryBuilder('task')
        .where('task.user_id = :user_id', { user_id })
        .andWhere('task.status = :status', { status: 'Complete' })
        .andWhere('task.updatedAt BETWEEN :startOfMonth AND :endOfMonth', { 
          startOfMonth, 
          endOfMonth 
        })
        .select([
          'task.id',
          'TO_CHAR(task.updatedAt, \'YYYY-MM-DD\') as date',
        ])
        .getRawMany();

      // Group tasks by date and count them
      const dateCounts = completedTasks.reduce((acc, task) => {
        const date = new Date(task.date);
        // Use local date components to avoid timezone issues
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        acc[dateStr] = (acc[dateStr] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Generate all days in the month
      const allDays: CalendarHeatmap[] = [];
      const currentDate = new Date(startOfMonth);
      
      while (currentDate <= endOfMonth) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        allDays.push({
          date: dateStr,
          value: dateCounts[dateStr] || 0
        });
        
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return {
        status: 'success',
        message: 'Calendar heatmap data retrieved successfully',
        data: allDays,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch calendar heatmap data',
        error: error.message || error,
      };
    }
  }
  
  public async getStreakCount(user_id: string): Promise<{
    status: 'success' | 'error';
    message: string;
    data?: { 
      count: number;
    };
    error?: any;
  }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Check for completed tasks today
      const startOfToday = new Date(today);
      const endOfToday = new Date(today);
      endOfToday.setHours(23, 59, 59, 999);
      
      const hasCompletedToday = !!(await this.taskInstanceRepository.findOne({
        where: {
          user: { user_id },
          status: 'Complete',
          updatedAt: Between(startOfToday, endOfToday),
        },
        select: ['id'],
      }));
      
      // Get all completed task dates for the user in the last 2 years
      const twoYearsAgo = new Date(today);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      
      const completedTasks = await this.taskInstanceRepository.find({
        where: {
          user: { user_id },
          status: 'Complete',
          updatedAt: MoreThanOrEqual(twoYearsAgo),
        },
        select: ['updatedAt'],
      });
      
      // Create a Set of unique dates (YYYY-MM-DD) when tasks were completed
      const completedDates = new Set(
        completedTasks.map(task => 
          task.updatedAt.toISOString().split('T')[0]
        )
      );
      
      // Calculate streak by checking consecutive days
      let streak = 0;
      let currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() - 1); // Start from yesterday
      
      while (streak < 730) { // 2 years max
        const dateStr = currentDate.toISOString().split('T')[0];
        if (!completedDates.has(dateStr)) {
          break;
        }
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      }
      
      return {
        status: 'success',
        message: 'Streak count retrieved successfully',
        data: {
          count: hasCompletedToday ? streak + 1 : streak,
        }
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to retrieve streak count',
        error: error instanceof Error ? error.message : error,
      };
    }
  }

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
        }
      });

      if (!task) {
        this.logger.warn(`Task with ID ${task_id} not found`);
        throw new NotFoundException(`Task with ID ${task_id} not found`);
      }

      if (user_id !== task.user.user_id) {
        this.logger.warn(`Unauthorized status update attempt for task ${task_id} by user ${user_id}`);
        throw new UnauthorizedException('Access denied: Not your data.');
      }

      // Log the status change
      if (task.status !== status) {
        this.logger.log(`Task ${task_id} (${task.title || 'No title'}) status changing from '${task.status}' to '${status}'`);
        if (status === 'Complete') {
          this.logger.log(`Marking task ${task_id} as Complete`);
        }
      } else {
        this.logger.debug(`Task ${task_id} status already set to '${status}', no change needed`);
      }

      const response = await this.taskInstanceRepository.update(
        { task_id },
        { status: status as 'Complete' | 'Pending' | 'Overdue' }
      );
      // Emit event for notification system
      if (response.affected && response.affected > 0) {
        if(status === 'Complete') {
          this.logger.log(`Successfully updated task ${task_id} status to '${status}'`);
          this.eventEmitter.emit('task.completed', {
            userId: task.user.user_id,
            taskId: task.task_id,
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
      this.logger.error(`Failed to update task ${task_id} status: ${error.message}`, error.stack);
      return {
        status: 'error',
        message: 'Failed to update task status',
        error: error?.message || error,
      };
    }
  }

  async updateSubTaskStatus(taskSubInstance_id: string, status: string, user_id: string) {
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
        }
      });

      if (!subTask) {
        this.logger.warn(`SubTask with ID ${taskSubInstance_id} not found`);
        throw new NotFoundException(`SubTask with ID ${taskSubInstance_id} not found`);
      }

      if (user_id !== subTask.user.user_id) {
        this.logger.warn(`Unauthorized status update attempt for subTask ${taskSubInstance_id} by user ${user_id}`);
        throw new UnauthorizedException('Access denied: Not your data.');
      }

      // Log the status change
      if (subTask.status !== status) {
        this.logger.log(`SubTask ${taskSubInstance_id} (${subTask.title || 'No title'}) status changing from '${subTask.status}' to '${status}'`);
        if (status === 'Complete') {
          this.logger.log(`Marking subTask ${taskSubInstance_id} as Complete`);
        }
      } else {
        this.logger.debug(`SubTask ${taskSubInstance_id} status already set to '${status}', no change needed`);
      }

      await this.taskSubInstanceRepository.update(
        { taskSubInstance_id },
        { status: status as 'Complete' | 'Pending' | 'Overdue' }
      );

      this.logger.log(`Successfully updated subTask ${taskSubInstance_id} status to '${status}'`);
      return {
        status: 'success',
        message: `SubTask updated to ${status} successfully`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to update subTask ${taskSubInstance_id} status: ${error.message}`, error.stack);
      return {
        status: 'error',
        message: 'Failed to update subTask status',
        error: error?.message || error,
      };
    }
  }
}
