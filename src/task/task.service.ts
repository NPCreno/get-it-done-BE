import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskInstance } from './models/taskInstance.entity';
import { TaskTemplate } from './models/taskTemplate.entity';
import { CreateTaskDto } from './dto/create-task-dto';
import { DeepPartial } from 'typeorm';
import { Users } from 'src/user/models/user.entity';
import { Projects } from 'src/projects/models/projects.entity';
@Injectable()
export class TaskService {
    constructor (
        @InjectRepository(TaskTemplate) private readonly taskTemplateRepository: Repository<TaskTemplate>,
        @InjectRepository(TaskInstance) private readonly taskInstanceRepository: Repository<TaskInstance>,
        @InjectRepository(Users) private readonly usersRepository: Repository<Users>,
        @InjectRepository(Projects) private readonly projectsRepository: Repository<Projects>,
    ){}

    private generateTaskInstanceId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'task-' + randomNumber.toString().padStart(9, '0');
    }

    private generateTaskTemplateId(): string {
      const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
      return 'taskTemplate-' + randomNumber.toString().padStart(9, '0');
    }

    async createTask(taskDto: CreateTaskDto): Promise<{ status: string; message: string; data?: TaskInstance | TaskTemplate; error?: any }> {
      try {
        // find user_id
        const user_id = taskDto.user_id
        const userExist = await this.usersRepository.findOne({ where: { user_id } }); 
        if(!userExist){
          throw new NotFoundException(`User with ID ${user_id} not found`);
        }

        // find project_id
        const project_id = taskDto?.project_id
        const projectExists = await this.projectsRepository.findOne({ where: { project_id } }); 
        if(!projectExists){
          throw new NotFoundException(`Project with ID ${project_id} not found`);
        }

        let task_id: string;
        let taskTemplate_id: string;
        let exists = true;

        if(taskDto.isRecurring){
          do {
          taskTemplate_id = this.generateTaskTemplateId(); 
          const existing = await this.taskTemplateRepository.findOne({ where: { taskTemplate_id } }); 
          exists = !!existing;
        } while (exists);
        const {
          user_id,
          title,
          description,
          repeat_every,
          repeat_days,
          start_date,
          end_date
        } = taskDto;

        const taskTemplate = this.taskTemplateRepository.create({
        taskTemplate_id,
        user_id,
        title,
        description,
        repeat_every,
        repeat_days,
        start_date,
        end_date,
        } as DeepPartial<TaskTemplate>);

        const savedTaskTemplate = await this.taskTemplateRepository.save(taskTemplate);

        return {
          status: "success",
          message: "Recurring task created successfully",
          data: savedTaskTemplate,
        };
        }else{
          do {
            // Generate unique task_id
            task_id = this.generateTaskInstanceId(); 
            const existing = await this.taskInstanceRepository.findOne({ where: { task_id } }); 
            exists = !!existing;
          } while (exists);

          // Create and save the new project
          let taskInstance: TaskInstance;
          if (taskDto.project_id) {
            taskInstance = this.taskInstanceRepository.create({
              ...taskDto,
              priority: taskDto.priority as 'Low' | 'Medium' | 'High',
              status: taskDto.status as 'Pending' | 'Complete',
              project: { project_id: taskDto.project_id },  // link project by project_id
              user: { user_id: taskDto.user_id },  // link user by user_id
              task_id,
            });
          }
          else{
            taskInstance = this.taskInstanceRepository.create({
            ...taskDto,
            priority: taskDto.priority as 'Low' | 'Medium' | 'High',
            status: taskDto.status as 'Pending' | 'Complete',
            user: { user_id: taskDto.user_id },  // link user by user_id
            task_id,
            });
          }

          const savedTask = await this.taskInstanceRepository.save(taskInstance);

          return {
          status: "success",
          message: "Task created successfully",
          data: savedTask,
          };
        }
      } catch (error) {
          console.error("Error creating task:", error);
          return {
          status: "error",
          message: "Failed to create task",
          error: error?.message || error,
          };
      }
    }
}
