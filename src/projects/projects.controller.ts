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
import { Projects } from './models/projects.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { UpdateProjectDto } from './dto/update-project-dto';

@Controller('api/projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @UseGuards(AuthorizeGuard)
  @Get('getAll')
  findAll() {
    return this.projectsService.findAll();
  }

  @Get('getAll/:user_id')
  findAllForUser(@Param('user_id') user_id: string) {
    return this.projectsService.findAllForUser(user_id);
  }

  @UseGuards(AuthorizeGuard)
  @Get(':project_id')
  findOne(@Param('project_id') project_id: string): Promise<Projects> {
    return this.projectsService.findOne(project_id);
  }

  @UseGuards(AuthorizeGuard)
  @Post('create')
  async create(@Body() dto: CreateProjectDto): Promise<{
    status: string;
    message: string;
    data?: Projects;
    error?: any;
  }> {
    return this.projectsService.createProject(dto);
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':project_id')
  async update(
    @Param('project_id') project_id: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ): Promise<Projects> {
    return this.projectsService.updateOne(project_id, updateProjectDto);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':project_id')
  async softDeleteOne(@Param('id') project_id: string): Promise<Projects> {
    return this.projectsService.softDeleteOne(project_id);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':project_id/hard')
  async hardDeleteOne(@Param('id') project_id: string): Promise<Projects> {
    return this.projectsService.hardDeleteOne(project_id);
  }
}
