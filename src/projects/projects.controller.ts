import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UnauthorizedException,
    UseGuards,
  } from '@nestjs/common';
  import { ProjectsService } from './projects.service';
  import { CreateProjectDto } from './dto/create-project-dto';
  import { ProjectEntity } from './models/projects.entity';
  import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
  import { UpdateProjectDto } from './dto/update-project-dto';
import { SanitizedProject } from './interfaces/sanitizedProject';
import { AuthenticatedRequest } from 'src/auth/Interfaces/authenticatedRequest';
  
  @Controller('api/projects')
  export class ProjectsController {
    constructor(private projectsService: ProjectsService) {}
  
    @UseGuards(AuthorizeGuard)
    @Get('getAll')
    findAll( @Req() req: AuthenticatedRequest): Promise<ProjectEntity[]> {
      const tokenUserId = req['user'];
      if (tokenUserId.role !== 'admin') {
          throw new UnauthorizedException('Access denied: Admin only.');
        }
      return this.projectsService.findAll();
    }
  
    @UseGuards(AuthorizeGuard)
    @Get('getAll/:user_id')
    findAllForUser(@Param('user_id') user_id: string, @Req() req: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
        data?: SanitizedProject[];
        error?: any;
      }> {
      const tokenUserId = req['user'];
      if (tokenUserId.user_id !== user_id) {
          throw new UnauthorizedException('Access denied: Not your data.');
        }
    return this.projectsService.findAllForUser(user_id, tokenUserId.user_id);
    }

    @UseGuards(AuthorizeGuard)
    @Get(':project_id')
    findOne(@Param('project_id') project_id: string, @Req() req: AuthenticatedRequest): Promise<{
      status: string;
      message: string;
      data?: ProjectEntity;
      error?: any;
    }> {
      const tokenUserId = req['user'];
      return this.projectsService.findOne(project_id, tokenUserId.user_id);
    }
  
    @UseGuards(AuthorizeGuard)
    @Post('create')
    async create(@Body() dto: CreateProjectDto, @Req() req: AuthenticatedRequest): Promise<{
      status: string;
      message: string;
      data?: ProjectEntity;
      error?: any;
    }> {
      const tokenUserId = req['user'];
      if (tokenUserId.user_id !== dto.user_id) {
          throw new UnauthorizedException('Access denied: Not your data.');
      }
      return this.projectsService.createProject(dto);
    }
  
    @UseGuards(AuthorizeGuard)
    @Patch(':project_id')
    async update(
      @Param('project_id') project_id: string,
      @Body() updateProjectDto: UpdateProjectDto,
      @Req() req: AuthenticatedRequest,
    ): Promise<{
      status: string;
      message: string;
      data?: ProjectEntity;
      error?: any;
    }> {
      const tokenUserId = req['user'];
      return this.projectsService.updateOne(project_id, updateProjectDto, tokenUserId.user_id);
    }
  
    @UseGuards(AuthorizeGuard)
    @Delete(':project_id')
    async softDeleteOne(@Param('project_id') project_id: string, @Req() req: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
        error?: any;
    }> {
      const tokenUserId = req['user'];
      return this.projectsService.softDeleteOne(project_id, tokenUserId.user_id);
    }
  
    @UseGuards(AuthorizeGuard)
    @Delete(':project_id/hard')
    async hardDeleteOne(@Param('project_id') project_id: string, @Req() req: AuthenticatedRequest): Promise<{
        status: string;
        message: string;
        error?: any;
      }> {
    const tokenUserId = req['user'];
    return this.projectsService.hardDeleteOne(project_id, tokenUserId.user_id);
    }
  }
  