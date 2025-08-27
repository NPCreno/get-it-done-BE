import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, Observable } from 'rxjs';
import { TaskService } from 'src/task/task.service';
import { NotificationsEntity } from './models/notifications.entity';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { notificationRules } from './notification.rules';
import { User } from 'src/user/models/user.interface';

export interface NotificationEvent {
  type: string;
  message: string;
  data?: any;
  timestamp: Date;
}

@Injectable()
export class NotificationsService {
  private notificationSubject = new Subject<MessageEvent>();

  constructor(
    private readonly taskService: TaskService,
     @InjectRepository(NotificationsEntity) private readonly notificationsRepository: Repository<NotificationsEntity>,
    ) {}


    private generateNotifId(): string {
        const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
        return 'notif-' + randomNumber.toString().padStart(9, '0');
      }
    
    @OnEvent('task.completed')
    async handleTaskCompletion(payload: { userId: string; taskId: string;}) {
        const { userId, taskId } = payload;
        const completedCount = await this.taskService.countCompletedTasks(payload.userId);
        
        for (const rule of notificationRules.milestones) {
            if (rule.condition(completedCount)) {
            const notification = this.notificationsRepository.create({
                notif_id: this.generateNotifId(),
                user: { user_id: userId } as User,
                type: rule.type as 'achievement' | 'milestone' | 'streak' | 'levelUp' | 'reward' | 'taskDue',
                title: rule.title,
                message: rule.message(completedCount),
                read: false,
                actionType: rule.actionType as 'acknowledge' | 'complete' | 'claim',
                actionTarget: rule.actionTarget,
                metadata: rule.metadata(completedCount, taskId),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        
            await this.notificationsRepository.save(notification);
        
            this.sendNotification({
                type: rule.type,
                message: notification.message,
                data: notification.metadata,
            });
            break;
            }
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
        await this.notificationsRepository.delete({ user: { user_id } });
      }
}
