import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskQueryService } from './task-query.service';
import { SubTaskService } from './subtask.service';
import { TaskStatusService } from './task-status.service';
import { TaskStatsService } from './task-stats.service';
import { TaskStreakService } from './task-streak.service';
import { TaskRecurrenceService } from './task-recurrence.service';
import { UserModule } from 'src/user/user.module';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskGeneratorService } from './taskGenerator.service';
import { TaskSubInstanceEntity } from './models/taskSubInstance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskInstanceEntity,
      TaskTemplateEntity,
      ProjectEntity,
      UserEntity,
      TaskSubInstanceEntity,
    ]),
    AuthModule,
    UserModule,
  ],
  providers: [
    TaskService,
    TaskQueryService,
    SubTaskService,
    TaskStatusService,
    TaskStatsService,
    TaskStreakService,
    TaskRecurrenceService,
    TaskGeneratorService,
  ],
  controllers: [TaskController],
  exports: [TaskQueryService, TaskStreakService, TaskGeneratorService],
})
export class TaskModule {}
