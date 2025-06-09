import { Body, Module, Param, Post } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Projects } from './models/projects.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskService } from 'src/task/task.service';
import { TaskTemplate } from 'src/task/models/taskTemplate.entity';
import { TaskInstance } from 'src/task/models/taskInstance.entity';
import { Users } from 'src/user/models/user.entity';
import { TaskModule } from 'src/task/task.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Projects, TaskTemplate, TaskInstance, Users]),
    AuthModule,
    TaskModule,
  ],
  providers: [ProjectsService, TaskService],
  controllers: [ProjectsController]
})

export class ProjectsModule {}


