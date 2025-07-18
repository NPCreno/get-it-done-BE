import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
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
import { TaskCompletionTrend } from './interfaces/taskCompletionTrend';
import { TaskDistribution } from './interfaces/taskDistribution';
import { TaskInstanceResponse } from './interfaces/taskInstanceResponse';
import { CalendarHeatmap } from './interfaces/calendarHeatmap';
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

    const sortedData = data
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

      return {
        status: 'success',
        message: 'Tasks fetched successfully',
        data: sortedData,
      };
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to fetch calendar heatmap data',
        error: error.message || error,
      };
    }
  }
  
  async getStreakCount(user_id: string): Promise<{
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
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to retrieve streak count',
        error: error instanceof Error ? error.message : error,
      };
    }
  }

  async updateTaskStatus(task_id: string, status: string, user_id: string){
    try {
      const task = await this.taskInstanceRepository.findOne({
        where: { task_id },
        relations: ['user'],
        select: {
          id: true,
          task_id: true,
          user: {
            user_id: true,
          }
        }
      });
      if (!task) throw new NotFoundException(`Task with ID ${task_id} not found`);
      if (user_id !== task.user.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
      }
      await this.taskInstanceRepository.update({ task_id }, { status: status as 'Complete' | 'Pending' | 'Overdue' });
      return {
        status: 'success',
        message: `Task updated to ${status} successfully`,
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Failed to update task status',
        error: error?.message || error,
      };
    }
  }
}
