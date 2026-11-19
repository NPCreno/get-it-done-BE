import {
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, Observable, filter, map } from 'rxjs';
import { withHeartbeatAndExpiry } from './notification-stream';
import { decodeCursor, encodeCursor } from './notification-cursor';
import { NotificationDto, toNotificationDto } from './notification.dto';
import { TaskStreakService } from 'src/task/task-streak.service';
import { NotificationsEntity } from './models/notifications.entity';
import { DeepPartial, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import * as notificationRulesJson from './notification.rules.json';
import { User } from 'src/user/models/user.interface';
import { awardKeyFor } from './award-key';
import { UserAwardEntity } from './models/user-award.entity';
import { NotificationRule } from './models/notification.interfaces';
import { API_CONTRACT } from 'src/common/api-contract';
import {
  CHAT_UNREAD_CHANGED,
  ChatUnreadChangedEvent,
} from 'src/chat/chat-events';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');
  private notificationSubject = new Subject<{
    userId: string;
    event: MessageEvent;
  }>();

  constructor(
    private readonly taskStreakService: TaskStreakService,
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
    const streak = await this.taskStreakService.getStreakInfo(userId);
    let given = 0;

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
              given++;
              this.sendNotification(userId, notification);
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
    this.logger.debug(
      `task.completed handled: task ${taskId}, awards given ${given}`,
    );
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
  getNotificationStream(
    userId: string,
    expiresAtMs?: number,
  ): Observable<MessageEvent> {
    const live = this.notificationSubject.pipe(
      filter((e) => e.userId === userId),
      map((e) => e.event),
    );
    return withHeartbeatAndExpiry(live, { expiresAtMs });
  }

  /** Called only after the notification row is committed. */
  sendNotification(userId: string, notification: NotificationsEntity) {
    const dto = toNotificationDto(notification);
    this.notificationSubject.next({
      userId,
      event: {
        id: dto.notif_id,
        type: 'notification',
        data: JSON.stringify(dto),
      },
    });
  }

  /**
   * FEAT-08a: a chat write changed these users' unread counts. One `chat`
   * event per user on their stream, with no notification id (Nest numbers
   * id-less frames, as for `ping`) and no text or counts: the FE refetches
   * GET /api/chat/unread.
   */
  @OnEvent(CHAT_UNREAD_CHANGED)
  handleChatUnreadChanged(payload: ChatUnreadChangedEvent) {
    const data = JSON.stringify({ project_id: payload.projectId });
    for (const userId of new Set(payload.userIds)) {
      this.notificationSubject.next({
        userId,
        event: { type: API_CONTRACT.chat.sseEventType, data },
      });
    }
  }

  async list(
    userId: string,
    limit = 50,
    cursor?: string,
    unreadOnly = false,
  ): Promise<{
    items: NotificationDto[];
    unread_count: number;
    next_cursor: string | null;
  }> {
    const page = this.notificationsRepository
      .createQueryBuilder('n')
      .where('"n"."user_id" = :uid', { uid: userId })
      .orderBy('n.id', 'DESC')
      .take(limit + 1);
    if (cursor)
      page.andWhere('n.id < :before', { before: decodeCursor(cursor) });
    if (unreadOnly) page.andWhere('n.read = false');
    const rows = await page.getMany();
    const unread_count = await this.notificationsRepository
      .createQueryBuilder('n')
      .where('"n"."user_id" = :uid', { uid: userId })
      .andWhere('n.read = false')
      .getCount();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map(toNotificationDto),
      unread_count,
      next_cursor: hasMore ? encodeCursor(items[items.length - 1].id) : null,
    };
  }

  /** Idempotent. A missing row and another user's row are the same 404. */
  async markRead(userId: string, notifId: string): Promise<void> {
    const res = await this.notificationsRepository
      .createQueryBuilder()
      .update(NotificationsEntity)
      .set({ read: true })
      .where('"notif_id" = :notifId AND "user_id" = :uid', {
        notifId,
        uid: userId,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();
    if (!res.affected) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.notificationsRepository
      .createQueryBuilder()
      .update(NotificationsEntity)
      .set({ read: true })
      .where('"user_id" = :uid AND "read" = false', { uid: userId })
      .andWhere('"deletedAt" IS NULL')
      .execute();
    return res.affected ?? 0;
  }

  async clearNotifications(user_id: string) {
    await this.notificationsRepository.delete({ user: { user_id } });
  }
}
