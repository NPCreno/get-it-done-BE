import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskInstance } from './models/taskInstance.entity';
import { TaskTemplate } from './models/taskTemplate.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({})

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskInstance, TaskTemplate]),
    AuthModule,
  ],
  providers: [TaskService],
  controllers: [TaskController]
})

export class TaskModule {}
