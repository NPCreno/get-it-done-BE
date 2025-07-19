import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ProjectEntity } from './models/projects.entity';
import { LessThanOrEqual, Repository } from 'typeorm';
import { CreateProjectDto } from './dto/create-project-dto';
import { UpdateProjectDto } from './dto/update-project-dto';
import { TaskInstanceEntity } from 'src/task/models/taskInstance.entity';
import { TaskTemplateEntity } from 'src/task/models/taskTemplate.entity';
import { TaskService } from 'src/task/task.service';
import { SanitizedProject } from './interfaces/sanitizedProject';

@Injectable()
export class ProjectsService {
    constructor (
        private readonly taskService: TaskService,
        @InjectRepository(ProjectEntity) private readonly projectsRepository: Repository<ProjectEntity>,
        @InjectRepository(TaskInstanceEntity) private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
        @InjectRepository(TaskTemplateEntity) private readonly taskTemplateRepository: Repository<TaskTemplateEntity>,
    ){}

    private generateProjectId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'PRJ-' + randomNumber.toString().padStart(9, '0');
    }

    async findOne(project_id: string, tokenUserId: string): Promise<{
        status: string;
        message: string;
        data?: ProjectEntity;
        error?: any;
    }> {
        try {
            const project = await this.projectsRepository.findOne({ where: { project_id } });
            if (!project) {
                throw new NotFoundException(`Project with ID ${project_id} not found`);
            }
            if (project.user_id !== tokenUserId) {
                throw new UnauthorizedException('Access denied: Not your data.');
            }
            return {
                status: 'success',
                message: 'Project fetched successfully',
                data: project,
                error: null
            }
        } catch (error: any) {
            return {
                status: 'error',
                message: 'Failed to find project',
                error: error,
            }
        }
    }

    async findAll(): Promise<ProjectEntity[]> {
    const projects = await this.projectsRepository.find();
    if (projects.length === 0) {
        throw new NotFoundException('No projects found');
    }
    return projects;
    }
    
    async findAllForUser(user_id: string, tokenUserId: string): Promise<{
    status: string;
    message: string;
    data?: SanitizedProject[];
    error?: any;
    }> {
    try {
        const projects = await this.projectsRepository.find({
        where: { user: { user_id } },
        relations: ['user'],
        withDeleted: false,
        });

        if (projects.length === 0) {
        throw new NotFoundException(`No projects found for user ID ${user_id}`);
        }

        const sanitizedProjects: SanitizedProject[] = [];

        for (const project of projects) {
        const startDate = new Date().toISOString();
        const endDate = new Date(new Date().setDate(new Date().getDate() + 1)).toISOString();
        const tasks = await this.taskService.getTasksByProj(tokenUserId, project.project_id, startDate, endDate);

        const { user, taskInstances, ...rest } = project;

        sanitizedProjects.push({
            ...rest,
            task_count: tasks.length,
            task_completed: tasks.filter((task) => task.status?.toLowerCase() === 'complete').length,
        });
        }

        return {
        status: 'success',
        message: 'Projects fetched successfully',
        data: sanitizedProjects,
        };
    } catch (error: any) {
        return {
        status: 'error',
        message: 'Failed to fetch projects',
        error: error,
        };
    }
    }

    async findDueProjects(): Promise<ProjectEntity[]> {
    const projects = await this.projectsRepository.find({
        where: {
        due_date: LessThanOrEqual(new Date()),
        },
    });
    if (projects.length === 0) {
        throw new NotFoundException('No projects found');
    }
    return projects;
    }

    async createProject(projectDto: CreateProjectDto): Promise<{ 
        status: string; 
        message: string; 
        data?: ProjectEntity; 
        error?: any 
    }> {
    try {
        let project_id: string;
        let exists = true;

        // Generate unique project_id
        do {
        project_id = this.generateProjectId(); 
        const existing = await this.projectsRepository.findOne({ where: { project_id } }); 
        exists = !!existing;
        } while (exists);

        // Create and save the new project
        const project = this.projectsRepository.create({
        ...projectDto,
        project_id,
        });

        const savedProject = await this.projectsRepository.save(project);

        return {
        status: "success",
        message: "Project created successfully",
        data: savedProject,
        };
    } catch (error: any) {
        console.error("Error creating project:", error);
        return {
        status: "error",
        message: "Failed to create project",
        error: error,
        };
    }
    }

    async updateOne(
        project_id: string, 
        updateProjectsDto: UpdateProjectDto, 
        tokenUserId: string
    ): Promise<{
        status: string;
        message: string;
        data?: ProjectEntity;
        error?: any;
    }> {
    const project = await this.projectsRepository.findOne({ where: { project_id } });
    if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
    }
    if (project.user_id !== tokenUserId) {
        throw new UnauthorizedException('Access denied: Not your data.');
    }
    await this.projectsRepository.update({ project_id }, updateProjectsDto);
    const updatedProject = await this.projectsRepository.findOne({ where: { project_id } });
    if (!updatedProject) throw new NotFoundException(`Updated user not found`);
    return {
        status: "success",
        message: "Project updated successfully",
        data: updatedProject,
    };
    }

    async softDeleteOne(project_id: string,tokenUserId: string): Promise<{
        status: string;
        message: string;
        error?: any;
    }> {
    try {
        const project = await this.projectsRepository.findOne({ where: { project_id } });
        if (!project) {
            throw new NotFoundException(`Project with ID ${project_id} not found`);
        }
        if (project.user_id !== tokenUserId) {
            throw new UnauthorizedException('Access denied: Not your data.');
        }
        project.deletedAt = new Date();
        await this.projectsRepository.save(project);

        // Soft-delete related TaskTemplates
        await this.taskTemplateRepository
        .createQueryBuilder()
        .softDelete()
        .where("project_id = :project_id", { project_id })
        .execute();
        console.log("deleting related task templates")

        // Soft-delete related TaskInstances
        await this.taskInstanceRepository
        .createQueryBuilder()
        .softDelete()
        .where("project_id = :project_id", { project_id })
        .execute();
        console.log("deleting related task instances")

        const updatedProject = await this.projectsRepository.findOne({
            where: { project_id },
            withDeleted: true
        });

        if (!updatedProject) throw new NotFoundException(`Updated user not found`);
        return {
                status: 'success',
                message: `Project with ID ${project_id} soft deleted successfully`,
                error: null
        };
    } catch (error) {
        console.error("Error during soft delete:", error);
        throw new NotFoundException(`Project with ID ${project_id} not found`);
    }
    }

    async hardDeleteOne(
        project_id: string, 
        tokenUserId: string
    ): Promise<{
    status: string;
    message: string;
    error?: any;
    }> {
    try {
        const project = await this.projectsRepository.findOne({ 
        where: { project_id },
        withDeleted: true
        });
        if (!project) {
            throw new NotFoundException(`Project with ID ${project_id} not found`);
        }
        if (project.user_id !== tokenUserId) {
            throw new UnauthorizedException('Access denied: Not your data.');
        }
        await this.projectsRepository.remove(project);
        return {
            status: 'success',
            message: 'Project deleted successfully',
            };
    }catch (error: any) {
        return {
        status: 'error',
        message: 'Failed to create task',
        error: error,
      };
    }
    }
}
