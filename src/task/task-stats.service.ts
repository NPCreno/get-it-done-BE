import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { IDashboardData } from './interfaces/dashboardData';
import { TaskCompletionTrend } from './interfaces/taskCompletionTrend';
import { TaskDistribution } from './interfaces/taskDistribution';
import { CalendarHeatmap } from './interfaces/calendarHeatmap';
import { myTasks } from './task-scope';

/**
 * FEAT-09a (D2): every count is over "my tasks", the tasks I'm responsible for
 * (COALESCE(assignee_id, user_id) = me) that I may still see (`myTasks`).
 */
@Injectable()
export class TaskStatsService {
  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
  ) {}

  /** One COUNT query. Soft-deleted tasks are excluded by the query builder. */
  async countCompletedTasks(user_id: string): Promise<number> {
    return this.taskInstanceRepository
      .createQueryBuilder('t')
      .where(myTasks('t'), { uid: user_id })
      .andWhere('"t"."status" = :status', { status: 'Complete' })
      .getCount();
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

      const allProjects = await this.projectsRepository.count({
        where: { user_id },
      });

      // Same window as before: no due date, inside [start, end], or overdue.
      let window = 't.due_date IS NULL';
      const params: Record<string, unknown> = { uid: user_id };
      if (startDate && endDate) {
        window =
          '(t.due_date IS NULL OR t.due_date BETWEEN :start AND :end OR t.due_date < :start)';
        params.start = new Date(startDate);
        params.end = new Date(endDate);
      }
      const counts = await this.taskInstanceRepository
        .createQueryBuilder('t')
        .select(`count(*) FILTER (WHERE ${window})`, 'all_tasks')
        .addSelect(
          `count(*) FILTER (WHERE ${window} AND t.status = 'Pending')`,
          'pending_tasks',
        )
        .addSelect(
          `count(*) FILTER (WHERE t.status = 'Complete')`,
          'complete_tasks',
        )
        .where(myTasks('t'))
        .setParameters(params)
        .getRawOne<{
          all_tasks: string;
          pending_tasks: string;
          complete_tasks: string;
        }>();

      return {
        status: 'success',
        message: 'Dashboard data fetched successfully',
        data: {
          all_tasks: Number(counts?.all_tasks ?? 0),
          pending_tasks: Number(counts?.pending_tasks ?? 0),
          complete_tasks: Number(counts?.complete_tasks ?? 0),
          all_projects: allProjects,
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
    endDate: string,
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

      // Fetch my completed tasks within the date range
      const tasks = await this.taskInstanceRepository
        .createQueryBuilder('t')
        .select(['t.id', 't.updatedAt'])
        .where(myTasks('t'), { uid: user_id })
        .andWhere(`t.status = 'Complete'`)
        .andWhere('t.updatedAt BETWEEN :start AND :end', { start, end })
        .orderBy('t.updatedAt', 'ASC')
        .getMany();

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
          weekday: 'short',
        });

        dateMap.set(dateStr, { completed: 0, day: dayOfWeek });

        // Move to the next day in local time
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Count completed tasks by date
      tasks.forEach((task) => {
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
              completed: dateData.completed + 1,
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
          completed,
        }));

      return {
        status: 'success',
        message: 'Task completion trend retrieved successfully',
        data: result,
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
    year: string,
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
      const startOfMonth = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        1,
      );
      const endOfMonth = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth() + 1,
        0,
        23,
        59,
        59,
      );

      // My completed tasks this month per project: projects I own or am a
      // member of (not deleted, created by the month's end), labelled with
      // the project title. Owner or member of a live project = may see them.
      const projects: {
        title: string | null;
        color: string | null;
        value: number;
      }[] = await this.projectsRepository.query(
        `SELECT p."id", p."title", p."color", count(t."id")::int AS "value"
           FROM "project_entity" p
           LEFT JOIN "task_instance_entity" t
             ON t."project_id" = p."project_id" AND t."deletedAt" IS NULL
            AND t."status" = 'Complete'
            AND t."updatedAt" BETWEEN $2 AND $3
            AND COALESCE(t."assignee_id", t."user_id") = $1
          WHERE p."deletedAt" IS NULL AND p."createdAt" <= $3
            AND (p."user_id" = $1 OR EXISTS (
              SELECT 1 FROM "project_members" m
               WHERE m."project_id" = p."project_id" AND m."user_id" = $1))
          GROUP BY p."id", p."title", p."color"
          ORDER BY p."id" ASC`,
        [user_id, startOfMonth, endOfMonth],
      );

      const distributionData = projects.map((row) => ({
        title: row.title || 'Untitled Project',
        value: Number(row.value),
        fill: row.color || '#808080', // Default to gray if no color is set
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
    year: string,
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
      const startOfMonth = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        1,
      );
      const endOfMonth = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth() + 1,
        0,
        23,
        59,
        59,
      );

      // Fetch all completed tasks for the user in the target month
      const completedTasks = await this.taskInstanceRepository
        .createQueryBuilder('task')
        .where(myTasks('task'), { uid: user_id })
        .andWhere('task.status = :status', { status: 'Complete' })
        .andWhere('task.updatedAt BETWEEN :startOfMonth AND :endOfMonth', {
          startOfMonth,
          endOfMonth,
        })
        .select(['task.id', "TO_CHAR(task.updatedAt, 'YYYY-MM-DD') as date"])
        .getRawMany();

      // Group tasks by date and count them
      const dateCounts = completedTasks.reduce(
        (acc, task) => {
          const date = new Date(task.date);
          // Use local date components to avoid timezone issues
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          acc[dateStr] = (acc[dateStr] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

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
          value: dateCounts[dateStr] || 0,
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
}
