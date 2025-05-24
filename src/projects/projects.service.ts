import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Projects } from './models/projects.entity';
import { LessThanOrEqual, Repository } from 'typeorm';
import { CreateProjectDto } from './dto/create-project-dto';
import { UpdateProjectDto } from './dto/update-project-dto';

@Injectable()
export class ProjectsService {
    constructor (
        @InjectRepository(Projects) private readonly projectsRepository: Repository<Projects>,
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
    
    async findAllForUser(user_id: string): Promise<any[]> { // change return type to any since user is not returned[] 
    const projects = await this.projectsRepository.find({
        where: { user: { user_id } },
        relations: ['user'],
        withDeleted: false,
    });
    if (projects.length === 0) {
        throw new NotFoundException(`No projects found for user ID ${user_id}`);
    }
    const sanitizedProjects = projects.map(({ user, ...rest }) => ({ // Map to remove user completely
        ...rest,
    }));
    return sanitizedProjects;
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

    async createProject(projectDto: CreateProjectDto): Promise<Projects> {
    let project_id: string;
    let exists = true;
    do {
        project_id = this.generateProjectId(); 
        const existing = await this.projectsRepository.findOne({ where: { project_id } }); 
        exists = !!existing;
    } while (exists); // Ensure unique project_id
    const project = this.projectsRepository.create({
        ...projectDto,
        project_id,
    });
    return this.projectsRepository.save(project);
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
    const updatedProject = await this.projectsRepository.findOne({
        where: { project_id },
        withDeleted: true
    });
    if (!updatedProject) throw new NotFoundException(`Updated user not found`);
    return updatedProject;
    }

    async hardDeleteOne(project_id: string): Promise<Projects> {
    const project = await this.projectsRepository.findOne({ 
        where: { project_id },
        withDeleted: true
    });
    if (!project) {
        throw new NotFoundException(`Project with ID ${project_id} not found`);
    }
    await this.projectsRepository.remove(project);

    return project;
    }
}
