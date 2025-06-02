import { Body, Controller, Post, UseGuards} from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task-dto';
import { TaskInstance } from './models/taskInstance.entity';
import { AuthorizeGuard } from 'src/auth/guards/authorize.guard';
import { TaskTemplate } from './models/taskTemplate.entity';
@Controller('api/task')
export class TaskController {
    constructor(private taskService: TaskService){}

    // @UseGuards(AuthorizeGuard)
    @Post('create')
    async create(@Body() dto: CreateTaskDto): Promise<{
    status: string;
    message: string;
    data?: TaskInstance | TaskTemplate;
    error?: any;
    }> {
    return this.taskService.createTask(dto);
    }
    
}