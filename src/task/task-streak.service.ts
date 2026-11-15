import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { computeStreak, StreakInfo } from './streak';

@Injectable()
export class TaskStreakService {
  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
  ) {}

  /** Loads the completion dates and runs the pure streak walk. */
  private async loadStreak(user_id: string): Promise<StreakInfo> {
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

    // Unique dates (YYYY-MM-DD) when tasks were completed
    const completedDates = new Set(
      completedTasks.map((task) => task.updatedAt.toISOString().split('T')[0]),
    );

    return computeStreak(completedDates, hasCompletedToday, today);
  }

  /** Streak count plus the run's start date. Used by the award listener only; throws on error. */
  async getStreakInfo(user_id: string): Promise<StreakInfo> {
    return this.loadStreak(user_id);
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
      const { count } = await this.loadStreak(user_id);
      return {
        status: 'success',
        message: 'Streak count retrieved successfully',
        data: { count },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to retrieve streak count',
        error: error instanceof Error ? error.message : error,
      };
    }
  }
}
