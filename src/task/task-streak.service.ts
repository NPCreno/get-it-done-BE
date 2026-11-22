import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { computeStreak, StreakInfo } from './streak';
import { myTasks } from './task-scope';

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

    // FEAT-09a (D2): my tasks = the ones I'm responsible for.
    const hasCompletedToday = !!(await this.completed(user_id)
      .andWhere('t.updatedAt BETWEEN :s AND :e', {
        s: startOfToday,
        e: endOfToday,
      })
      .select(['t.id'])
      .limit(1)
      .getOne());

    // Get all completed task dates for the user in the last 2 years
    const twoYearsAgo = new Date(today);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const completedTasks = await this.completed(user_id)
      .andWhere('t.updatedAt >= :since', { since: twoYearsAgo })
      .select(['t.id', 't.updatedAt'])
      .getMany();

    // Unique dates (YYYY-MM-DD) when tasks were completed
    const completedDates = new Set(
      completedTasks.map((task) => task.updatedAt.toISOString().split('T')[0]),
    );

    return computeStreak(completedDates, hasCompletedToday, today);
  }

  private completed(user_id: string) {
    return this.taskInstanceRepository
      .createQueryBuilder('t')
      .where(myTasks('t'), { uid: user_id })
      .andWhere(`t.status = 'Complete'`);
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
