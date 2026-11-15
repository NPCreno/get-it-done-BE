import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, Repository } from 'typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { TaskInstanceResponse } from './interfaces/taskInstanceResponse';

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
}
