import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, Observable } from 'rxjs';
import { TaskService } from 'src/task/task.service';
import { NotificationsEntity } from './models/notifications.entity';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';

export interface NotificationEvent {
  type: string;
  message: string;
  data?: any;
  timestamp: Date;
}

@Injectable()
export class NotificationsService {
  private notificationSubject = new Subject<MessageEvent>();
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly taskService: TaskService,
     @InjectRepository(NotificationsEntity) private readonly notificationsRepository: Repository<NotificationsEntity>,
    ) {}


    private generateNotifId(): string {
        const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
        return 'notif-' + randomNumber.toString().padStart(9, '0');
      }
    
    @OnEvent('task.completed')
    async handleTaskCompleted(payload: { userId: string; taskId: string }) {
        this.logger.log(`Received event: task.completed for user ${payload.userId}, task ${payload.taskId}`);
        const completedCount = await this.taskService.countCompletedTasks(payload.userId);

        // 2. Example logic: milestone every 10 completed tasks
        if (completedCount % 6 === 0) {
            this.logger.log(`🎉 User ${payload.userId} reached milestone: ${completedCount} completed tasks`);
    
            // 3. Create a notification in DB
            const notification = this.notificationsRepository.create({
                notif_id: this.generateNotifId(),
                user: { user_id: payload.userId } as any,
                type: 'achievement',
                title: 'Milestone Achieved!',
                message: `🎉 Congrats! You’ve completed ${completedCount} tasks!`,
                read: false,
                actionType: 'navigate',
                actionTarget: '/dashboard',
                metadata: {
                completedCount,
                lastTaskId: payload.taskId,
                },
            });
        
            await this.notificationsRepository.save(notification);
    
            // 4. Send to SSE clients
            this.sendNotification({
                type: 'achievement',
                message: notification.message,
                data: { completedCount, taskId: payload.taskId },
            });
        }
        }

    getNotificationStream(): Observable<MessageEvent> {
        return this.notificationSubject.asObservable();
      }
    
    sendNotification(notification: Omit<NotificationEvent, 'timestamp'>) {
        const notificationEvent: NotificationEvent = {
            ...notification,
            timestamp: new Date(),
        };

        this.notificationSubject.next({
            data: JSON.stringify(notificationEvent), // SSE needs string data
        } as MessageEvent);
    }

    async clearNotifications(user_id: string) {
       await this.notificationsRepository.delete(user_id);
    }
}
