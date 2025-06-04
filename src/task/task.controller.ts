import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task-dto';
import { TaskInstance } from './models/taskInstance.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { TaskTemplate } from './models/taskTemplate.entity';
import { UpdateTaskDto } from './dto/update-task-dto';
@Controller('api/task')
export class TaskController {
  constructor(private taskService: TaskService) {}

  @UseGuards(AuthorizeGuard)
  @Post('create')
  async create(@Body() dto: CreateTaskDto): Promise<{
    status: string;
    message: string;
    data?: TaskInstance | TaskTemplate;
    error?: any;
  }> {
    return this.taskService.createTask(dto);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getTasksByUser/:user_id')
  findAllForUser(@Param('user_id') user_id: string) {
    return this.taskService.findAllTasksForUser(user_id);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getTasksByProj/:project_id')
  getTasksByProj(
    @Param('project_id') project_id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.taskService.getTasksByProj(project_id, startDate, endDate);
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':task_id')
  async update(
    @Param('task_id') task_id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<TaskInstance> {
    return this.taskService.updateOne(task_id, updateTaskDto);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id')
  async softDeleteOne(
    @Param('task_id') task_id: string,
  ): Promise<TaskInstance> {
    return this.taskService.softDeleteOne(task_id);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id/hard')
  async hardDeleteOne(
    @Param('task_id') task_id: string,
  ): Promise<TaskInstance> {
    return this.taskService.hardDeleteOne(task_id);
  }
}
