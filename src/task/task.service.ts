import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstance } from './models/taskInstance.entity';
import { TaskTemplate } from './models/taskTemplate.entity';

@Injectable()
export class TaskService {
    constructor (
        @InjectRepository(TaskTemplate) private readonly taskTemplateRepository: Repository<TaskTemplate>,
        @InjectRepository(TaskInstance) private readonly taskInstanceRepository: Repository<TaskInstance>,
    ){}

    private generateTaskInstanceId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'TASK-' + randomNumber.toString().padStart(9, '0');
    }

    private generateTaskTemplateId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'TASK-TMP-' + randomNumber.toString().padStart(9, '0');
    }
}
