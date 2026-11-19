import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { TaskInstanceResponse } from './interfaces/taskInstanceResponse';

/** Filters for listOwnTasks (FEAT-07a MCP list_tasks / get_project). */
export interface OwnTaskFilters {
  status?: 'Pending' | 'Complete' | 'Overdue';
  project_id?: string;
  due_from?: Date;
  due_to?: Date;
  /** Title contains, case-insensitive. */
  search?: string;
  include_completed?: boolean;
  limit: number;
}

export interface SubtaskCounts {
  total: number;
  completed: number;
}

/** Escapes LIKE wildcards so a search is a plain substring match. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class TaskQueryService {
  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
  ) {}

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

      // Get all task IDs to fetch their sub-instances in a single query
      const taskIds = data.map((task) => task.task_id);
      const allSubInstances = await this.taskSubInstanceRepository.find({
        where: {
          instance: {
            task_id: In(taskIds),
          },
        },
        relations: ['instance'], // Include the instance relation
        order: {
          createdAt: 'ASC',
        },
      });

      // Group sub-instances by task_id
      const subInstancesByTaskId = allSubInstances.reduce(
        (acc, subInstance) => {
          // Safely access task_id with optional chaining
          const taskId = subInstance.instance?.task_id;
          if (!taskId) return acc; // Skip if no task_id found

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
            updatedAt: subInstance.updatedAt,
          });
          return acc;
        },
        {} as Record<string, any[]>,
      );

      const sortedData = data
        .map(({ user, project, template, ...rest }) => ({
          ...rest,
          user_id: user.user_id,
          project_id: project?.project_id ?? null,
          project_title: project?.title ?? null,
          template_id: template?.taskTemplate_id ?? null,
          subInstances: subInstancesByTaskId[rest.task_id] || [],
        }))
        .sort((a, b) => {
          if (a.status === 'Complete' && b.status !== 'Complete') return 1;
          if (a.status !== 'Complete' && b.status === 'Complete') return -1;
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
          if (a.status === 'Complete' && b.status !== 'Complete') return 1;
          if (a.status !== 'Complete' && b.status === 'Complete') return -1;
          return 0;
        });
    } catch (error: any) {
      console.error(`Error fetching tasks for project ${project_id}:`, error);
      return []; // Return empty array on error
    }
  }

  /**
   * The caller's own, non-deleted tasks with optional filters, soonest due
   * first (no due date last), then newest. Scoped by the token user: another
   * user's task never appears.
   */
  async listOwnTasks(
    userId: string,
    f: OwnTaskFilters,
  ): Promise<TaskInstanceEntity[]> {
    const where: FindOptionsWhere<TaskInstanceEntity> = {
      user: { user_id: userId },
    };
    if (f.status) where.status = f.status;
    else if (f.include_completed === false) where.status = Not('Complete');
    if (f.project_id) where.project = { project_id: f.project_id };
    if (f.due_from && f.due_to) where.due_date = Between(f.due_from, f.due_to);
    else if (f.due_from) where.due_date = MoreThanOrEqual(f.due_from);
    else if (f.due_to) where.due_date = LessThanOrEqual(f.due_to);
    if (f.search) where.title = ILike(`%${likeEscape(f.search)}%`);
    return this.taskInstanceRepository.find({
      where,
      relations: ['project', 'template'],
      order: {
        due_date: { direction: 'ASC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
      take: f.limit,
    });
  }

  /** The caller's own task, or null when it is missing, deleted or not theirs. */
  async findOwnTask(
    userId: string,
    taskId: string,
  ): Promise<TaskInstanceEntity | null> {
    return this.taskInstanceRepository.findOne({
      where: { task_id: taskId, user: { user_id: userId } },
      relations: ['project', 'template'],
    });
  }

  /** The caller's own sub-task (with its task id), or null. */
  async findOwnSubtask(
    userId: string,
    subtaskId: string,
  ): Promise<TaskSubInstanceEntity | null> {
    return this.taskSubInstanceRepository.findOne({
      where: { taskSubInstance_id: subtaskId, user: { user_id: userId } },
      relations: ['instance'],
    });
  }

  /** A task's non-deleted sub-tasks, oldest first. */
  async subtasksOf(taskId: string): Promise<TaskSubInstanceEntity[]> {
    return this.taskSubInstanceRepository.find({
      where: { instance: { task_id: taskId } },
      order: { createdAt: 'ASC' },
    });
  }

  /** Sub-task counts per task id, one aggregate query. */
  async subtaskCounts(taskIds: string[]): Promise<Map<string, SubtaskCounts>> {
    const out = new Map<string, SubtaskCounts>();
    if (taskIds.length === 0) return out;
    const rows = await this.taskSubInstanceRepository
      .createQueryBuilder('s')
      .select('"s"."task_id"', 'task_id')
      .addSelect('count(*)::int', 'total')
      .addSelect(`count(*) FILTER (WHERE s.status = 'Complete')::int`, 'done')
      .where('"s"."task_id" IN (:...ids)', { ids: taskIds })
      .groupBy('"s"."task_id"')
      .getRawMany<{ task_id: string; total: number; done: number }>();
    for (const r of rows)
      out.set(r.task_id, { total: Number(r.total), completed: Number(r.done) });
    return out;
  }
}
