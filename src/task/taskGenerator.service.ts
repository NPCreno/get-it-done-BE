import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  addDays,
} from 'date-fns';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskTemplate } from './models/taskTemplate.entity';
import { TaskInstance } from './models/taskInstance.entity';


@Injectable()
export class TaskGeneratorService {
  private readonly logger = new Logger(TaskGeneratorService.name);

  constructor(
    @InjectRepository(TaskTemplate)
    private readonly taskTemplateRepository: Repository<TaskTemplate>,
    @InjectRepository(TaskInstance)
    private readonly taskInstanceRepository: Repository<TaskInstance>,
  ) {}

  private generateTaskId(): string {
  return `generated_task-${Math.floor(Math.random() * 1_000_000_000)}`;
  }

  @Cron('0 0 * * *') // Every day at midnight
    async generateInstancesForCurrentMonth() {
    const timeZone = 'Asia/Manila';  // Change timezone here
    const templates = await this.taskTemplateRepository.find();
    const today = new Date();
    const rangeStart = startOfMonth(today);
    const rangeEnd = endOfMonth(today);

    for (const template of templates) {
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
            if (daysOfWeek.includes(dayName) && isWithin(d))
            taskDates.push(new Date(d));
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

        const existing = await this.taskInstanceRepository.findOne({
            where: {
            template: { id: template.id },
            due_date: dueDate,
            },
        });
        if (existing) continue;

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
            `Generated task instance: ${instance.task_id} due on ${formattedDate} (${timeZone})`,
        );
        }
    }

    this.logger.log('Task instances generated for current month');
    }
}
