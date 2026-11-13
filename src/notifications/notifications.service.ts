import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, Observable, filter, map } from 'rxjs';
import { TaskService } from 'src/task/task.service';
import { NotificationsEntity } from './models/notifications.entity';
import { DeepPartial, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import * as notificationRulesJson from './notification.rules.json';
import { User } from 'src/user/models/user.interface';
import { awardKeyFor } from './award-key';
import { UserAwardEntity } from './models/user-award.entity';
import {
  NotificationEvent,
  NotificationRule,
} from './models/notification.interfaces';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');
  private notificationSubject = new Subject<{
    userId: string;
    event: MessageEvent;
  }>();

  constructor(
    private readonly taskService: TaskService,
    @InjectRepository(NotificationsEntity)
    private readonly notificationsRepository: Repository<NotificationsEntity>,
  ) {}

  private generateNotifId(): string {
    const randomNumber = Math.floor(Math.random() * 1_000_000_000); // 0 to 999,999,999
    return 'notif-' + randomNumber.toString().padStart(9, '0');
  }

  /**
   * Awards are given once: each matched rule maps to an award key
   * (`awardKeyFor`), recorded in `user_awards` in the same transaction as the
   * notification row. SSE is sent only after that commit.
   * Known gap (no outbox, FU3): a crash between the status commit and this
   * listener, or a DB error here, loses that completion's awards without retry.
   */
  @OnEvent('task.completed')
  async handleTaskCompletion(payload: {
    userId: string;
    taskId: string;
    lifetimeCount: number;
  }) {
    const { userId, taskId, lifetimeCount } = payload;
    const streak = await this.taskService.getStreakInfo(userId);

    for (const notifType of notificationRulesJson.notifTypes) {
      for (const rules of Object.values(notifType)) {
        for (const rule of rules as NotificationRule[]) {
          const metricValue =
            rule.type === 'streak' ? streak.count : lifetimeCount;
          const awardKey = awardKeyFor(rule, metricValue, {
            streakStart: streak.start,
          });
          if (!awardKey) continue;

          try {
            const notification = await this.giveAward(
              userId,
              taskId,
              rule,
              awardKey,
              lifetimeCount,
              streak.count,
            );
            if (notification) {
              this.sendNotification(userId, {
                type: rule.type,
                message: notification.message,
                data: notification.metadata,
              });
            }
          } catch (error: any) {
            // The award and its notification roll back together; no retry.
            this.logger.error(
              `Award ${awardKey} failed for task ${taskId}: ${error?.message}`,
            );
          }
        }
      }
    }
  }

  /** Inserts the award and its notification in one transaction; null when already given. */
  private giveAward(
    userId: string,
    taskId: string,
    rule: NotificationRule,
    awardKey: string,
    lifetimeCount: number,
    currentStreak: number,
  ): Promise<NotificationsEntity | null> {
    return this.notificationsRepository.manager.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(UserAwardEntity)
        .values({ user_id: userId, award_key: awardKey })
        .orIgnore()
        .returning('award_key')
        .execute();
      const raw = inserted.raw as unknown[];
      if (!raw || raw.length === 0) return null;

      const notification = manager.create(NotificationsEntity, {
        notif_id: this.generateNotifId(),
        user: { user_id: userId } as User,
        type: rule.type,
        title: rule.title,
        message: rule.message
          .replace('{count}', String(lifetimeCount))
          .replace('{streak}', String(currentStreak))
          .replace('{taskId}', taskId),
        read: false,
        actionType: rule.actionType,
        actionTarget: rule.actionTarget,
        metadata: {
          ...rule.metadata,
          completedCount: lifetimeCount,
          currentStreak,
          taskId,
        },
      } as DeepPartial<NotificationsEntity>);
      return manager.save(notification);
    });
  }

  /** Only the caller's own events: the subject is shared by every user. */
  getNotificationStream(userId: string): Observable<MessageEvent> {
    return this.notificationSubject.pipe(
      filter((e) => e.userId === userId),
      map((e) => e.event),
    );
  }

  sendNotification(
    userId: string,
    notification: Omit<NotificationEvent, 'timestamp'>,
  ) {
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
