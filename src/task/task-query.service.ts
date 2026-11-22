import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import {
  TaskInstanceResponse,
  TaskProjectRow,
  TaskSharingFields,
} from './interfaces/taskInstanceResponse';
import { TaskSubInstanceResponse } from './interfaces/taskSubInstanceResponse';
import { accessibleTo, myTasks } from './task-scope';
import { TaskAccessService, rethrowAccess } from './task-access.service';

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

/** Who created, who is assigned, who owns the project (one query per list). */
interface TaskMeta {
  task_id: string;
  creator_id: string;
  creator_username: string | null;
  assignee_id: string | null;
  assignee_username: string | null;
  owner_id: string | null;
  owner_username: string | null;
}

/** Escapes LIKE wildcards so a search is a plain substring match. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const completeLast = (a: { status: string }, b: { status: string }) => {
  if (a.status === 'Complete' && b.status !== 'Complete') return 1;
  if (a.status !== 'Complete' && b.status === 'Complete') return -1;
  return 0;
};

/** The entity's own columns, without relations (the old `...rest`). */
function columnsOf(t: TaskInstanceEntity) {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { user, project, template, assignee, subInstances, ...rest } = t;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest;
}

/** FEAT-09a fields; can_delete = the viewer owns the project or created the task. */
function sharingOf(
  m: TaskMeta | undefined,
  viewerId: string,
): TaskSharingFields {
  return {
    user_id: m?.creator_id ?? '',
    creator_username: m?.creator_username ?? null,
    assignee_id: m?.assignee_id ?? null,
    assignee_username: m?.assignee_username ?? null,
    can_delete: !!m && (m.creator_id === viewerId || m.owner_id === viewerId),
  };
}

@Injectable()
export class TaskQueryService {
  constructor(
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
    @InjectRepository(TaskSubInstanceEntity)
    private readonly taskSubInstanceRepository: Repository<TaskSubInstanceEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly access: TaskAccessService,
  ) {}

  /**
   * "My tasks" (FEAT-09a D2): tasks I'm responsible for,
   * COALESCE(assignee_id, user_id) = me, that I may still see. Same date
   * window as before: no due date, inside [start, end], or overdue.
   */
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
      const qb = this.baseQuery()
        .leftJoinAndSelect('t.template', 'tpl')
        .where(myTasks('t'), { uid: user_id });
      if (startDate && endDate) {
        qb.andWhere(
          '(t.due_date IS NULL OR t.due_date BETWEEN :start AND :end OR t.due_date < :start)',
          { start: new Date(startDate), end: new Date(endDate) },
        );
      } else {
        qb.andWhere('t.due_date IS NULL');
      }
      const data = await qb.getMany();
      return {
        status: 'success',
        message: 'Tasks fetched successfully',
        data: (await this.toUserRows(data, user_id)).sort(completeLast),
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch tasks',
        error: error?.message || error,
      };
    }
  }

  /**
   * One task as a getTasksByUser row, for the assignee route. Throws 404 when
   * the viewer may not see it.
   */
  async taskRow(
    taskId: string,
    viewerId: string,
  ): Promise<TaskInstanceResponse> {
    const t = await this.baseQuery()
      .leftJoinAndSelect('t.template', 'tpl')
      .where('t.task_id = :tid', { tid: taskId })
      .andWhere(accessibleTo('t'), { uid: viewerId })
      .getOne();
    if (!t) throw new NotFoundException('Task not found');
    const [row] = await this.toUserRows([t], viewerId);
    return row;
  }

  /**
   * Every task of a project the caller owns or is a member of (FEAT-09a). A
   * stranger, a missing and a deleted project are 404 `Project not found`
   * (was `[]`). Still a raw array.
   */
  async getTasksByProj(
    tokenUserId: string,
    project_id: string,
    startDate?: string,
    endDate?: string,
  ): Promise<TaskProjectRow[]> {
    try {
      await this.access.assertCanUseProject(project_id, tokenUserId);
      const qb = this.taskInstanceRepository
        .createQueryBuilder('t')
        .leftJoinAndSelect('t.project', 'p')
        .where('"t"."project_id" = :pid', { pid: project_id });
      if (startDate && endDate) {
        qb.andWhere(
          '(t.due_date IS NULL OR t.due_date BETWEEN :start AND :end)',
          {
            start: new Date(startDate),
            end: new Date(endDate),
          },
        );
      } else {
        qb.andWhere('t.due_date IS NULL');
      }
      const data = await qb.getMany();
      const meta = await this.metaOf(data.map((t) => t.task_id));
      return data
        .map((t) => ({
          ...columnsOf(t),
          project_id: t.project.project_id,
          ...sharingOf(meta.get(t.task_id), tokenUserId),
        }))
        .sort(completeLast);
    } catch (error: any) {
      rethrowAccess(error);
      console.error(`Error fetching tasks for project ${project_id}:`, error);
      return []; // Return empty array on error
    }
  }

  /**
   * MCP list_tasks / get_project (FEAT-09a): without a project, the tasks
   * I'm responsible for; with `project_id`, every task of that project I may
   * see. Not deleted, soonest due first (no due date last), then newest.
   */
  async listOwnTasks(
    userId: string,
    f: OwnTaskFilters,
  ): Promise<TaskInstanceEntity[]> {
    const qb = this.mcpQuery();
    if (f.project_id) {
      qb.where('"t"."project_id" = :pid', { pid: f.project_id }).andWhere(
        accessibleTo('t'),
        { uid: userId },
      );
    } else {
      qb.where(myTasks('t'), { uid: userId });
    }
    if (f.status) qb.andWhere('t.status = :status', { status: f.status });
    else if (f.include_completed === false)
      qb.andWhere(`t.status <> 'Complete'`);
    if (f.due_from) qb.andWhere('t.due_date >= :from', { from: f.due_from });
    if (f.due_to) qb.andWhere('t.due_date <= :to', { to: f.due_to });
    if (f.search)
      qb.andWhere('t.title ILIKE :search', {
        search: `%${likeEscape(f.search)}%`,
      });
    return qb
      .orderBy('t.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('t.createdAt', 'DESC')
      .limit(f.limit)
      .getMany();
  }

  /** A task the caller may work on (owner, member, creator), or null. */
  async findOwnTask(
    userId: string,
    taskId: string,
  ): Promise<TaskInstanceEntity | null> {
    return this.mcpQuery()
      .where('t.task_id = :tid', { tid: taskId })
      .andWhere(accessibleTo('t'), { uid: userId })
      .getOne();
  }

  /** A sub-task (with its task id) of a task the caller may work on, or null. */
  async findOwnSubtask(
    userId: string,
    subtaskId: string,
  ): Promise<TaskSubInstanceEntity | null> {
    return this.taskSubInstanceRepository
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.instance', 't')
      .where('s.taskSubInstance_id = :sid', { sid: subtaskId })
      .andWhere(accessibleTo('t'), { uid: userId })
      .getOne();
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

  /** Tasks with their project (a soft-deleted project joins as null, as before). */
  private baseQuery(): SelectQueryBuilder<TaskInstanceEntity> {
    return this.taskInstanceRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.project', 'p');
  }

  /** baseQuery + template + the usernames the MCP shapes show. */
  private mcpQuery(): SelectQueryBuilder<TaskInstanceEntity> {
    return this.baseQuery()
      .leftJoinAndSelect('t.template', 'tpl')
      .leftJoin('t.assignee', 'a')
      .addSelect(['a.id', 'a.user_id', 'a.username'])
      .leftJoin('p.user', 'po')
      .addSelect(['po.id', 'po.user_id', 'po.username']);
  }

  private async toUserRows(
    data: TaskInstanceEntity[],
    viewerId: string,
  ): Promise<TaskInstanceResponse[]> {
    const taskIds = data.map((task) => task.task_id);
    const [meta, subs] = await Promise.all([
      this.metaOf(taskIds),
      this.subInstancesOf(taskIds),
    ]);
    return data.map((t) => {
      const m = meta.get(t.task_id);
      const project_id = t.project?.project_id ?? null;
      return {
        ...columnsOf(t),
        project_id,
        project_title: t.project?.title ?? null,
        project_owner_username: project_id ? (m?.owner_username ?? null) : null,
        template_id: t.template?.taskTemplate_id ?? null,
        subInstances: subs.get(t.task_id) ?? [],
        ...sharingOf(m, viewerId),
      };
    });
  }

  private async metaOf(taskIds: string[]): Promise<Map<string, TaskMeta>> {
    const out = new Map<string, TaskMeta>();
    if (taskIds.length === 0) return out;
    const rows: TaskMeta[] = await this.taskInstanceRepository.query(
      `SELECT t."task_id", t."user_id" AS "creator_id",
              cu."username" AS "creator_username",
              t."assignee_id", au."username" AS "assignee_username",
              p."user_id" AS "owner_id", ou."username" AS "owner_username"
         FROM "task_instance_entity" t
         LEFT JOIN "users" cu ON cu."user_id" = t."user_id"
         LEFT JOIN "users" au ON au."user_id" = t."assignee_id"
         LEFT JOIN "project_entity" p ON p."project_id" = t."project_id"
         LEFT JOIN "users" ou ON ou."user_id" = p."user_id"
        WHERE t."task_id" = ANY($1)`,
      [taskIds],
    );
    for (const r of rows) out.set(r.task_id, r);
    return out;
  }

  private async subInstancesOf(
    taskIds: string[],
  ): Promise<Map<string, TaskSubInstanceResponse[]>> {
    const out = new Map<string, TaskSubInstanceResponse[]>();
    if (taskIds.length === 0) return out;
    const all = await this.taskSubInstanceRepository.find({
      where: { instance: { task_id: In(taskIds) } },
      relations: ['instance'],
      order: { createdAt: 'ASC' },
    });
    for (const s of all) {
      const taskId = s.instance?.task_id;
      if (!taskId) continue;
      const list = out.get(taskId) ?? [];
      list.push({
        id: s.id,
        taskSubInstance_id: s.taskSubInstance_id,
        title: s.title,
        status: s.status,
        due_date: s.due_date,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
      out.set(taskId, list);
    }
    return out;
  }
}
