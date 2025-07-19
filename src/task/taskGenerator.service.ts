import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  addDays,
} from 'date-fns';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { TaskTemplateEntity } from './models/taskTemplate.entity';
import { TaskInstanceEntity } from './models/taskInstance.entity';


@Injectable()
export class TaskGeneratorService {
  private readonly logger = new Logger(TaskGeneratorService.name);
  private readonly BATCH_SIZE = 100; // Process templates in batches to avoid memory issues

  constructor(
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplateRepository: Repository<TaskTemplateEntity>,
    @InjectRepository(TaskInstanceEntity)
    private readonly taskInstanceRepository: Repository<TaskInstanceEntity>,
  ) {}

  private generateTaskId(): string {
  return `generated_task-${Math.floor(Math.random() * 1_000_000_000)}`;
  }

  @Cron('0 0 * * *') // Every day at midnight
  async generateInstancesForCurrentMonth() {
    const timeZone = 'Asia/Manila';
    
    // Process templates in batches
    const batchSize = this.BATCH_SIZE;
    let skip = 0;
    let totalProcessed = 0;
    let totalCount = 0;

    while (true) {
      const [templates, count] = await this.taskTemplateRepository.findAndCount({
        take: batchSize,
        skip: skip,
        order: { id: 'ASC' } // Ensure consistent ordering
      });

      if (templates.length === 0) {
        this.logger.debug('No more templates to process');
        break;
      }

      // Update total count on first iteration
      if (totalCount === 0) {
        totalCount = count;
      }

      this.logger.log(`Processing batch of ${templates.length} templates (${skip + 1}-${skip + templates.length}/${totalCount})`);
      
      // Process current batch
      await this.processTemplatesBatch(templates, timeZone);
      
      totalProcessed += templates.length;
      
      // Stop if we've processed all templates or if we received fewer templates than requested
      if (templates.length < batchSize || totalProcessed >= totalCount) {
        break;
      }
      
      skip += batchSize;
    }
    
    this.logger.log('Task instances generation completed');
  }

  private async processTemplatesBatch(templates: TaskTemplateEntity[], timeZone: string): Promise<void> {
    const today = new Date();
    const rangeStart = startOfMonth(today);
    const rangeEnd = endOfMonth(today);

    for (const template of templates) {
      try {
        const taskDates: Date[] = [];

        const isWithin = (date: Date) =>
          isWithinInterval(date, {
            start: template.start_date,
            end: template.end_date ?? rangeEnd,
          }) &&
          isWithinInterval(date, { start: rangeStart, end: rangeEnd });

        if (template.repeat_every === 'Day') {
          for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
            if (isWithin(d)) taskDates.push(new Date(d));
          }
        }

        if (template.repeat_every === 'Week') {
          const daysOfWeek = (template.repeat_days || []).map(day =>
            day.toLowerCase(),
          );
          for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
            const dayName = d
              .toLocaleDateString('en-US', { weekday: 'long' })
              .toLowerCase();
            if (daysOfWeek.includes(dayName) && isWithin(d)) {
              taskDates.push(new Date(d));
            }
          }
        }

        if (template.repeat_every === 'Month') {
          const day = template.start_date.getDate();
          const thisMonthDate = new Date(
            today.getFullYear(),
            today.getMonth(),
            day,
          );
          if (isWithin(thisMonthDate)) taskDates.push(thisMonthDate);
        }

        for (const due of taskDates) {
          const dueDate = new Date(due.setHours(23, 59, 0, 0));

          // Check if task already exists (including soft-deleted ones)
          const existing = await this.taskInstanceRepository.findOne({
            where: {
              template: { id: template.id },
              due_date: dueDate,
            },
            withDeleted: true, // Include soft-deleted records in the search
          });

          // Skip if task exists (either active or soft-deleted)
          if (existing) {
            this.logger.debug(
              `Skipping generation - task already exists for template ${template.id} on ${dueDate}`
            );
            continue;
          }

          const instance = this.taskInstanceRepository.create({
            task_id: this.generateTaskId(),
            user: { user_id: template.user_id } as any,
            project: { project_id: template.project_id } as any,
            title: template.title,
            description: template.description,
            priority: 'Medium',
            status: 'Pending',
            due_date: dueDate,
            template,
          });

          await this.taskInstanceRepository.save(instance);

          // Format dueDate in Manila timezone, long date style
          const formattedDate = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
          }).format(dueDate);

          this.logger.log(
            `Generated task instance: ${instance.task_id} due on ${formattedDate} (${timeZone})`
          );
        }
        this.logger.log(`Successfully processed template ${template.id}`);
      } catch (error) {
        this.logger.error(`Error processing template ${template.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
