import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { ChatAccessService, MESSAGE_NOT_FOUND } from './chat-access.service';
import {
  CHAT_UNREAD_CHANGED,
  ChatUnreadChangedEvent,
  unreadRecipients,
} from './chat-events';
import { ChatReadPointDto, ChatUnreadDto } from './chat.dto';

/**
 * Chat unread counts (FEAT-08a).
 * Unread = messages in a project the user can chat in (owner or member,
 * project not deleted) that are not deleted, not the user's own, and newer than
 * the read point. Read point = the later of chat_reads.last_read_at and, for a
 * member, their join time (project_members.created_at), so history from before
 * they joined never counts. The owner with no row: everything counts.
 */
@Injectable()
export class ChatUnreadService {
  private readonly logger = new Logger('ChatUnreadService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatAccessService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * One query. Each project's count stops at the cap (a LIMIT inside the
   * lateral), so it walks at most `cap` index entries of
   * (project_id, created_at DESC, id) per project.
   */
  async unread(userId: string): Promise<ChatUnreadDto> {
    const items: { project_id: string; unread_count: number }[] =
      await this.dataSource.query(
        `WITH mine AS (
           SELECT p."project_id", NULL::timestamptz AS "joined_at"
             FROM "project_entity" p
            WHERE p."user_id" = $1 AND p."deletedAt" IS NULL
           UNION ALL
           SELECT m."project_id", m."created_at"
             FROM "project_members" m
             JOIN "project_entity" p
               ON p."project_id" = m."project_id" AND p."deletedAt" IS NULL
            WHERE m."user_id" = $1)
         SELECT mine."project_id", n."unread_count"
           FROM mine
           LEFT JOIN "chat_reads" r
             ON r."project_id" = mine."project_id" AND r."user_id" = $1
          CROSS JOIN LATERAL (
            SELECT count(*)::int AS "unread_count"
              FROM (SELECT 1 FROM "chat_messages" c
                     WHERE c."project_id" = mine."project_id"
                       AND c."deleted_at" IS NULL
                       AND c."user_id" <> $1
                       AND c."created_at" > COALESCE(
                             GREATEST(r."last_read_at", mine."joined_at"),
                             '-infinity')
                     LIMIT $2) x) n
          WHERE n."unread_count" > 0
          ORDER BY mine."project_id"`,
        [userId, API_CONTRACT.chat.unreadCap],
      );
    return {
      items,
      total: items.reduce((sum, i) => sum + i.unread_count, 0),
    };
  }

  /**
   * Moves the read point to a message in this project (a deleted one counts:
   * the user may have seen it). Never moves back. Idempotent. A stranger, or a
   * message from another project, is 404.
   */
  async markRead(
    projectId: string,
    userId: string,
    messageId: string,
  ): Promise<ChatReadPointDto> {
    await this.access.assertCanChat(projectId, userId);
    const rows: { last_read_at: Date }[] = await this.dataSource.query(
      `WITH msg AS (
         SELECT "created_at" FROM "chat_messages"
          WHERE "id" = $3 AND "project_id" = $1)
       INSERT INTO "chat_reads" ("project_id", "user_id", "last_read_at")
       SELECT $1, $2, msg."created_at" FROM msg
       ON CONFLICT ("project_id", "user_id")
       DO UPDATE SET "last_read_at" =
         GREATEST("chat_reads"."last_read_at", EXCLUDED."last_read_at")
       RETURNING "last_read_at"`,
      [projectId, userId, messageId],
    );
    if (rows.length === 0) throw new NotFoundException(MESSAGE_NOT_FOUND);
    // After the write: the reader's other tabs drop the badge too.
    this.notify([userId], projectId);
    return {
      project_id: projectId,
      last_read_at: new Date(rows[0].last_read_at).toISOString(),
    };
  }

  /** The owner and every member except the actor (one query). */
  async recipients(projectId: string, actorId: string): Promise<string[]> {
    const rows: { owner_id: string; member_ids: string[] | null }[] =
      await this.dataSource.query(
        `SELECT p."user_id" AS "owner_id",
                array_remove(array_agg(m."user_id"), NULL) AS "member_ids"
           FROM "project_entity" p
           LEFT JOIN "project_members" m ON m."project_id" = p."project_id"
          WHERE p."project_id" = $1
          GROUP BY p."user_id"`,
        [projectId],
      );
    if (rows.length === 0) return [];
    return unreadRecipients(
      rows[0].owner_id,
      rows[0].member_ids ?? [],
      actorId,
    );
  }

  /** Call only after the write has committed. */
  notify(userIds: string[], projectId: string): void {
    if (userIds.length === 0) return;
    const event: ChatUnreadChangedEvent = { userIds, projectId };
    this.events.emit(CHAT_UNREAD_CHANGED, event);
  }

  /**
   * A message was created or deleted: everyone else in the project. The write
   * has already succeeded, so a failure here is logged, never thrown.
   */
  async notifyOthers(projectId: string, actorId: string): Promise<void> {
    try {
      this.notify(await this.recipients(projectId, actorId), projectId);
    } catch (error: unknown) {
      this.logger.error(
        `chat unread event failed: ${(error as Error)?.message}`,
      );
    }
  }
}
