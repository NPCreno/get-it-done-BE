import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Projects } from './models/projects.entity';
import { LessThanOrEqual, Repository } from 'typeorm';
import { CreateProjectDto } from './dto/create-project-dto';
import { UpdateProjectDto } from './dto/update-project-dto';
import { TaskInstance } from 'src/task/models/taskInstance.entity';
import { TaskTemplate } from 'src/task/models/taskTemplate.entity';
import { TaskService } from 'src/task/task.service';
import { SanitizedProject } from './interfaces/sanitizedProject';

@Injectable()
export class ProjectsService {
    constructor (
        private readonly taskService: TaskService,
        @InjectRepository(Projects) private readonly projectsRepository: Repository<Projects>,
        @InjectRepository(Projects) private readonly taskInstanceRepository: Repository<TaskInstance>,
        @InjectRepository(Projects) private readonly taskTemplateRepository: Repository<TaskTemplate>,
    ){}

    private generateProjectId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'PRJ-' + randomNumber.toString().padStart(9, '0');
    }

    async findOne(project_id: string): Promise<Projects> {
    const project = await this.projectsRepository.findOne({ where: { project_id } });
    if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
    }
    return project
    }

    async findAll(): Promise<Projects[]> {
    const projects = await this.projectsRepository.find();
    if (projects.length === 0) {
        throw new NotFoundException('No projects found');
    }
    return projects;
    }
    
    async findAllForUser(user_id: string): Promise<{
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
        const tasks = await this.taskService.getTasksByProj(project.project_id, startDate, endDate);

        const { user, taskInstances, ...rest } = project;

        sanitizedProjects.push({
            ...rest,
            task_count: tasks.length,
        });
        }

        return {
        status: 'success',
        message: 'Projects fetched successfully',
        data: sanitizedProjects,
        };
    } catch (error) {
        return {
        status: 'error',
        message: 'Failed to fetch projects',
        error: error?.message || error,
        };
    }
    }

    async findDueProjects(): Promise<Projects[]> {
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

    async createProject(projectDto: CreateProjectDto): Promise<{ status: string; message: string; data?: Projects; error?: any }> {
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
    } catch (error) {
        console.error("Error creating project:", error);
        return {
        status: "error",
        message: "Failed to create project",
        error: error?.message || error,
        };
    }
    }

    async updateOne(project_id: string, updateProjectsDto: UpdateProjectDto): Promise<Projects> {
    const project = await this.projectsRepository.findOne({ where: { project_id } });
    if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
    }
    await this.projectsRepository.update({ project_id }, updateProjectsDto);
    const updatedProject = await this.projectsRepository.findOne({ where: { project_id } });
    if (!updatedProject) throw new NotFoundException(`Updated user not found`);
    return updatedProject;
    }

    async softDeleteOne(project_id: string): Promise<Projects> {
    const project = await this.projectsRepository.findOne({ where: { project_id } });
    if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
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
    return updatedProject;
    }

    async hardDeleteOne(project_id: string): Promise<{
    status: string;
    message: string;
    data?: Projects;
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
        await this.projectsRepository.remove(project);
        return {
            status: 'success',
            message: 'Project deleted successfully',
            data: project,
            };
    }catch (error) {
        return {
        status: 'error',
        message: 'Failed to create task',
        error: error?.message || error,
      };
    }
    }
}
