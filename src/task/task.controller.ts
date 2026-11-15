import {
  BadRequestException,
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
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { SelfParam } from 'src/auth/guards/self-param.guard';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { UpdateTaskDto } from './dto/update-task-dto';
import { IDashboardData } from './interfaces/dashboardData';
import { StatusValidationPipe } from 'src/pipes/status-validation.pipe';
import { AuthUserId } from 'src/auth/decorators/auth-user-id.decorator';
import { ParseArrayPipe } from '@nestjs/common';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';
import { CreateTaskSubInstanceDto } from './dto/create-task-subInstance-dto';
@Controller('api/tasks')
export class TaskController {
  constructor(private taskService: TaskService) {}

  @UseGuards(AuthorizeGuard)
  @Post('create')
  async create(
    @Body() dto: CreateTaskDto,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity | TaskTemplateEntity;
    error?: any;
  }> {
    return this.taskService.createTask(dto, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Post('bulk-create')
  async bulkCreate(
    @Body(
      new ParseArrayPipe({
        items: CreateTaskDto,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: false },
      }),
    )
    tasks: CreateTaskDto[],
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: (TaskInstanceEntity | TaskTemplateEntity)[];
    error?: any;
  }> {
    return this.taskService.createBulkTasks(tasks, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Post('createSubTask')
  async createSubTask(
    @Body() dto: CreateTaskSubInstanceDto,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity;
    error?: any;
  }> {
    return this.taskService.createTaskSubInstance(dto, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Post('bulk-create-subtasks')
  async bulkCreateSubTasks(
    @Body(
      new ParseArrayPipe({
        items: CreateTaskSubInstanceDto,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: false },
      }),
    )
    bulkDto: CreateTaskSubInstanceDto[],
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity[];
    error?: any;
  }> {
    return this.taskService.createBulkTaskSubInstances(bulkDto, userId);
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('getTasksByUser/:user_id')
  getTasksByUser(
    @AuthUserId() userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.taskService.getTasksByUser(userId, startDate, endDate);
  }

  @UseGuards(AuthorizeGuard)
  @Get('getTasksByProj/:project_id')
  getTasksByProj(
    @AuthUserId() userId: string,
    @Param('project_id') project_id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.taskService.getTasksByProj(
      userId,
      project_id,
      startDate,
      endDate,
    );
  }

  @UseGuards(AuthorizeGuard)
  @Patch(':task_id')
  async update(
    @Param('task_id') task_id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity;
    error?: any;
  }> {
    return this.taskService.updateOne(task_id, updateTaskDto, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id')
  async softDeleteOne(
    @Param('task_id') task_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskInstanceEntity | null;
    error?: any;
  }> {
    return this.taskService.softDeleteOne(task_id, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete('/subTask/:subTask_id')
  async softDeleteSubTask(
    @Param('subTask_id') subTask_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: TaskSubInstanceEntity | null;
    error?: any;
  }> {
    return this.taskService.softDeleteSubTask(subTask_id, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete(':task_id/hard')
  async hardDeleteOne(
    @Param('task_id') task_id: string,
    @AuthUserId() userId: string,
  ): Promise<TaskInstanceEntity> {
    return this.taskService.hardDeleteOne(task_id, userId);
  }

  @UseGuards(AuthorizeGuard)
  @Delete('deleteRecurringTasks/:taskTemplate_id')
  async deleteRecurringTasks(
    @Param('taskTemplate_id') taskTemplate_id: string,
    @AuthUserId() userId: string,
  ): Promise<{
    status: string;
    message: string;
    data?: {
      deletedInstances: TaskInstanceEntity[];
      deletedTemplate: TaskTemplateEntity | null;
    } | null;
    error?: any;
  }> {
    return this.taskService.deleteRecurringTasks(
      taskTemplate_id,
      userId,
      false,
    );
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('getDashboardData/:user_id')
  getDashboardData(
    @AuthUserId() userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{
    status: string;
    message: string;
    data?: IDashboardData;
    error?: string;
  }> {
    return this.taskService.getDashboardData(userId, startDate, endDate);
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('completion-trend/:user_id')
  async getCompletionTrend(
    @AuthUserId() userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    if (!startDate || !endDate) {
      throw new BadRequestException('Both startDate and endDate are required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (start > end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const data = await this.taskService.getTaskCompletionTrend(
      userId,
      startDate,
      endDate,
    );
    return data;
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('task-distribution/:user_id')
  async getTaskDistribution(
    @AuthUserId() userId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    if (!month || !year) {
      throw new BadRequestException('Both month and year are required');
    }

    const data = await this.taskService.getTaskDistribution(
      userId,
      month,
      year,
    );
    return data;
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('calendar-heatmap/:user_id')
  async getCalendarHeatmap(
    @AuthUserId() userId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    if (!month || !year) {
      throw new BadRequestException('Both month and year are required');
    }

    const data = await this.taskService.getCalendarHeatmap(userId, month, year);
    return data;
  }

  @UseGuards(AuthorizeGuard, SelfParam('user_id'))
  @Get('streak/:user_id')
  async getStreakCount(@AuthUserId() userId: string) {
    const data = await this.taskService.getStreakCount(userId);
    return data;
  }

  @UseGuards(AuthorizeGuard)
  @Patch('update-task-status/:task_id/status/:status')
  async updateTaskStatus(
    @AuthUserId() userId: string,
    @Param('task_id') task_id: string,
    @Param('status', new StatusValidationPipe()) status: string,
  ) {
    const data = await this.taskService.updateTaskStatus(
      task_id,
      status,
      userId,
    );

    return data;
  }

  @UseGuards(AuthorizeGuard)
  @Patch('update-subtask-status/:taskSubInstance_id/status/:status')
  async updateSubTaskStatus(
    @AuthUserId() userId: string,
    @Param('taskSubInstance_id') taskSubInstance_id: string,
    @Param('status', new StatusValidationPipe()) status: string,
  ) {
    const data = await this.taskService.updateSubTaskStatus(
      taskSubInstance_id,
      status,
      userId,
    );

    return data;
  }
}
