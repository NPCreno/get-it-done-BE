import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskInstanceEntity } from './models/taskInstance.entity';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { UserModule } from 'src/user/user.module';
import { ProjectEntity } from 'src/projects/models/projects.entity';
import { UserEntity } from 'src/user/models/user.entity';
import { TaskGeneratorService } from './taskGenerator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskInstanceEntity, TaskTemplateEntity, ProjectEntity, UserEntity]),
    AuthModule,
    UserModule,
  ],
  providers: [TaskService, TaskGeneratorService],
  controllers: [TaskController],
  exports: [TaskService, TaskGeneratorService],
})

export class TaskModule {}
