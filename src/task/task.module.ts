import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskInstance } from './models/taskInstance.entity';
import { TaskTemplate } from './models/taskTemplate.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { UserModule } from 'src/user/user.module';
import { Projects } from 'src/projects/models/projects.entity';
import { Users } from 'src/user/models/user.entity';

@Module({})

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskInstance, TaskTemplate, Projects, Users]),
    AuthModule,
    UserModule,
  ],
  providers: [TaskService],
  controllers: [TaskController]
})

export class TaskModule {}
