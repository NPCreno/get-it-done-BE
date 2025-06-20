import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task-dto';
import { TaskInstance } from './models/taskInstance.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { TaskTemplate } from './models/taskTemplate.entity';
import { UpdateTaskDto } from './dto/update-task-dto';
import { IDashboardData } from './interfaces/dashboardData';
@Controller('api/tasks')
export class TaskController {
  constructor(private taskService: TaskService) {}

  @UseGuards(AuthorizeGuard)
  @Post('create')
  async create(@Body() dto: CreateTaskDto, @Req() req: Request): Promise<{
    status: string;
    message: string;
    data?: TaskInstance | TaskTemplate;
    error?: any;
  }> {
    const tokenUserId = req['user'];
    if (tokenUserId.user.user_id !== dto.user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
    }
    return this.taskService.createTask(dto);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getTasksByUser/:user_id')
  getTasksByUser(
    @Req() req: Request,
    @Param('user_id') user_id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tokenUserId = req['user'];
    if (tokenUserId.user.user_id !== user_id) {
        throw new UnauthorizedException('Access denied: Not your data.');
    }
    return this.taskService.getTasksByUser(user_id, startDate, endDate);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getTasksByProj/:project_id')
  getTasksByProj(
    @Req() req: Request,
    @Param('project_id') project_id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tokenUserId = req['user'];
    return this.taskService.getTasksByProj(tokenUserId.user.user_id, project_id, startDate, endDate);
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':task_id')
  async update(
    @Param('task_id') task_id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @Req() req: Request,
  ): Promise<{
          status: string;
          message: string;
          data?: TaskInstance;
          error?: any;
        }> {
    const tokenUserId = req['user'];
    return this.taskService.updateOne(task_id, updateTaskDto, tokenUserId.user.user_id);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id')
  async softDeleteOne(
    @Param('task_id') task_id: string,
    @Req() req: Request,
  ):  Promise<{
          status: string;
          message: string;
          data?: TaskInstance | null;
          error?: any;
        }> {
    const tokenUserId = req['user'];
    return this.taskService.softDeleteOne(task_id, tokenUserId.user.user_id);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id/hard')
  async hardDeleteOne(
    @Param('task_id') task_id: string,
    @Req() req: Request,
  ): Promise<TaskInstance> {
    const tokenUserId = req['user'];
    return this.taskService.hardDeleteOne(task_id, tokenUserId.user.user_id);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getDashboardData/:user_id')
  getDashboardData(
    @Req() req: Request,
    @Param('user_id') user_id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ):Promise<{
      status: string;
      message: string;
      data?: IDashboardData;
      error?: string;
  }> {
    const tokenUserId = req['user'];
    if(tokenUserId.user.user_id !== user_id) {
      throw new UnauthorizedException('Access denied: Not your data.');
    }
    return this.taskService.getDashboardData(user_id, startDate, endDate);
  }
}
