import { Body, Module, Param, Post } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './models/projects.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskService } from 'src/task/task.service';
import { TaskTemplateEntity } from 'src/task/models/taskTemplate.entity';
import { TaskInstanceEntity } from 'src/task/models/taskInstance.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskModule } from 'src/task/task.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, TaskTemplateEntity, TaskInstanceEntity, UserEntity]),
    AuthModule,
    TaskModule,
  ],
  providers: [ProjectsService, TaskService],
  controllers: [ProjectsController]
})

export class ProjectsModule {}


