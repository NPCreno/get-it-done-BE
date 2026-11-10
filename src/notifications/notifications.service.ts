import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, Observable, filter, map } from 'rxjs';
import { TaskService } from 'src/task/task.service';
import { NotificationsEntity } from './models/notifications.entity';
import { DeepPartial, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import * as notificationRulesJson from './notification.rules.json';
import { User } from 'src/user/models/user.interface';
import { NotificationEvent, NotificationRule } from './models/notification.interfaces';

@Injectable()
export class NotificationsService {
  private notificationSubject = new Subject<{ userId: string; event: MessageEvent }>();

  constructor(
    private readonly taskService: TaskService,
     @InjectRepository(NotificationsEntity) private readonly notificationsRepository: Repository<NotificationsEntity>,
    ) {}


    private generateNotifId(): string {
        const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
        return 'notif-' + randomNumber.toString().padStart(9, '0');
      }
    
    private checkCondition(
      condition: NotificationRule['condition'],
      value: number
    ): boolean {
      if (condition.every && value % condition.every === 0 && value > 0) return true;
      if (condition.equals && value === condition.equals) return true;
      return false;
    }

    @OnEvent('task.completed')
    async handleTaskCompletion(payload: { userId: string; taskId: string }) {
      const { userId, taskId } = payload;
      const completedCount = await this.taskService.countCompletedTasks(userId);
      const currentStreak = (await this.taskService.getStreakCount(userId)).data?.count;
    
      for (const notifType of notificationRulesJson.notifTypes) {
        for (const [_, rules] of Object.entries(notifType)) {
          for (const rule of rules as NotificationRule[]) {
            const metricValue = rule.type === 'streak' ? currentStreak : completedCount;
    
            if (this.checkCondition(rule.condition, metricValue ?? 0)) {
              const notification = this.notificationsRepository.create({
                notif_id: this.generateNotifId(),
                user: { user_id: userId } as User,
                type: rule.type,
                title: rule.title,
                message: rule.message
                  .replace('{count}', String(completedCount))
                  .replace('{streak}', String(currentStreak ?? 0))
                  .replace('{taskId}', taskId),
                read: false,
                actionType: rule.actionType,
                actionTarget: rule.actionTarget,
                metadata: {
                  ...rule.metadata,
                  completedCount,
                  currentStreak,
                  taskId,
                },
              } as DeepPartial<NotificationsEntity>);
    
              await this.notificationsRepository.save(notification);
              this.sendNotification(userId, {
                type: rule.type,
                message: notification.message,
                data: notification.metadata,
              });
            }
          }
        }
      }
    }

    /** Only the caller's own events: the subject is shared by every user. */
    getNotificationStream(userId: string): Observable<MessageEvent> {
        return this.notificationSubject.pipe(
          filter((e) => e.userId === userId),
          map((e) => e.event),
        );
      }

    sendNotification(userId: string, notification: Omit<NotificationEvent, 'timestamp'>) {
        const notificationEvent: NotificationEvent = {
            ...notification,
            timestamp: new Date(),
        };

        this.notificationSubject.next({
            userId,
            event: { data: JSON.stringify(notificationEvent) } as MessageEvent, // SSE needs string data
        });
      }

    async clearNotifications(user_id: string) {
        await this.notificationsRepository.delete({ user: { user_id } });
      }
}
