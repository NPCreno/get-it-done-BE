import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project-dto';
import { ProjectEntity } from './models/projects.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { AdminOnlyGuard } from 'src/auth/guards/admin-only.guard';
import { SelfParam } from 'src/auth/guards/self-param.guard';
import { UpdateProjectDto } from './dto/update-project-dto';
import { SanitizedProject } from './interfaces/sanitizedProject';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';

@Controller('api/projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @UseGuards(AuthorizeGuard, AdminOnlyGuard)
  @Get('getAll')
  findAll(): Promise<ProjectEntity[]> {
    return this.projectsService.findAll();
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('getAll/:user_id')
  findAllForUser(@AuthUserId() userId: string): Promise<{
    status: string;
    message: string;
    data?: SanitizedProject[];
    error?: any;
  }> {
    return this.projectsService.findAllForUser(userId, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Get(':project_id')
  findOne(
    @Param('project_id') project_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: ProjectEntity;
    error?: any;
  }> {
    return this.projectsService.findOne(project_id, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Post('create')
  async create(
    @Body() dto: CreateProjectDto,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: ProjectEntity;
    error?: any;
  }> {
    return this.projectsService.createProject(dto, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':project_id')
  async update(
    @Param('project_id') project_id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: ProjectEntity;
    error?: any;
  }> {
    return this.projectsService.updateOne(project_id, updateProjectDto, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':project_id')
  async softDeleteOne(
    @Param('project_id') project_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    error?: any;
  }> {
    return this.projectsService.softDeleteOne(project_id, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':project_id/hard')
  async hardDeleteOne(
    @Param('project_id') project_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    error?: any;
  }> {
    return this.projectsService.hardDeleteOne(project_id, userId);
  }
}
