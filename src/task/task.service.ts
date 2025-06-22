import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { TaskInstance } from './models/taskInstance.entity';
import { TaskTemplate } from './models/taskTemplate.entity';
import { CreateTaskDto } from './dto/create-task-dto';
import { DeepPartial } from 'typeorm';
import { Users } from 'src/user/models/user.entity';
import { Projects } from 'src/projects/models/projects.entity';
import { TaskGeneratorService } from './taskGenerator.service';
import { OnModuleInit } from '@nestjs/common';
import { UpdateTaskDto } from './dto/update-task-dto';
import { IDashboardData } from './interfaces/dashboardData';
@Injectable()
export class TaskService implements OnModuleInit {
  constructor(
    @InjectRepository(TaskTemplate)
    private readonly taskTemplateRepository: Repository<TaskTemplate>,
    @InjectRepository(TaskInstance)
    private readonly taskInstanceRepository: Repository<TaskInstance>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Projects)
    private readonly projectsRepository: Repository<Projects>,
    private readonly taskGeneratorService: TaskGeneratorService,
  ) {}
  async onModuleInit() {
    await this.taskGeneratorService.generateInstancesForCurrentMonth(); //trigger cronjob for generating task instances from task template
  }

  private generateTaskInstanceId(): string {
    const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
    return 'task-' + randomNumber.toString().padStart(9, '0');
  }

  private generateTaskTemplateId(): string {
    const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
    return 'taskTemplate-' + randomNumber.toString().padStart(9, '0');
  }

  async createTask(taskDto: CreateTaskDto): Promise<{
    status: string;
    message: string;
    data?: TaskInstance | TaskTemplate;
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
      if(project_id != undefined){
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
        } as DeepPartial<TaskTemplate>);

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
        let taskInstance: TaskInstance;
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
    } catch (error) {
      console.error('Error creating task:', error);
      return {
        status: 'error',
        message: 'Failed to create task',
        error: error?.message || error,
      };
    }
  }

  async getTasksByUser(
    user_id: string,
    startDate?: string,
    endDate?: string,
  ): Promise<any[]> {
    const user = await this.usersRepository.findOne({ where: { user_id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${user_id} not found`);
    }

    const where: any[] = [{ user: { user_id }, due_date: IsNull() }];
    if (startDate && endDate) {
      where.push({
        user: { user_id },
        due_date: Between(new Date(startDate), new Date(endDate)),
      });
    }

    const data = await this.taskInstanceRepository.find({
      where,
      relations: ['user', 'project'],  // include project relation here
      withDeleted: false,
    });

    if (data.length === 0) {
      throw new NotFoundException(`No tasks found for user ID ${user_id}`);
    }

    return data
      .map(({ user, project, ...rest }) => ({
        ...rest,
        user_id: user.user_id,
        project_title: project?.title ?? null,
      }))
      .sort((a, b) => {
        if (a.status === "Complete" && b.status !== "Complete") return 1;
        if (a.status !== "Complete" && b.status === "Complete") return -1;
        return 0;
      });
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
    } catch (error) {
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
    data?: TaskInstance;
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
    } catch (error) {
      return {
            status: 'error',
            message: 'Failed to update task',
            error: error?.message || error,
            };
    }}

  async softDeleteOne(task_id: string, tokenUserId: string): Promise<{
    status: string;
    message: string;
    data?: TaskInstance | null;
    error?: any;
  }> {
    try {
      const task = await this.taskInstanceRepository.findOne({
        where: { task_id },
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
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to delete task',
        error: error?.message || error,
      };
    }
  }
  async hardDeleteOne(task_id: string, tokenUserId: string): Promise<TaskInstance> {
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

      const where: any[] = [{ user: { user_id }, due_date: IsNull() }];
      if (startDate && endDate) {
        where.push({
          user: { user_id },
          due_date: Between(new Date(startDate), new Date(endDate)),
        });
      }

      const projects = await this.projectsRepository.find({
        where: { user: { user_id } },
        relations: ['user'],
        withDeleted: false,
      });

      if (projects.length === 0) {
        throw new NotFoundException(`No projects found for user ID ${user_id}`);
      }

      const data = await this.taskInstanceRepository.find({
        where,
        relations: ['user', 'project'],
        withDeleted: false,
      });

      const pendingTasks = data.filter(task => task.status === 'Pending');
      const completeTasks = data.filter(task => task.status === 'Complete');

      return {
        status: 'success',
        message: 'Dashboard data fetched successfully',
        data: {
          all_tasks: data.length,
          pending_tasks: pendingTasks.length,
          complete_tasks: completeTasks.length,
          all_projects: projects.length,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to fetch dashboard data',
        error: error.message || error,
      };
    }
  }

}
