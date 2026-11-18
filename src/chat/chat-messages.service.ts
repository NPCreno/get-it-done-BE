import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { ChatAccessService, MESSAGE_NOT_FOUND } from './chat-access.service';
import { ChatRoomsService } from './chat-rooms.service';
import { ChatUnreadService } from './chat-unread.service';
import { decodeMessageCursor, encodeMessageCursor } from './chat-cursor';
import {
  ChatMessageDto,
  ChatMessagesPageDto,
  MessageDeletedDto,
  toMessageDto,
} from './chat.dto';

export { MESSAGE_NOT_FOUND };
const MESSAGE_COLUMNS = `m."id", m."project_id", m."user_id", u."username", m."body", m."created_at"`;

interface MessageRow {
  id: string;
  project_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: Date;
}

@Injectable()
export class ChatMessagesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatAccessService,
    private readonly rooms: ChatRoomsService,
    private readonly unread: ChatUnreadService,
  ) {}

  /**
   * Newest first. Order (created_at DESC, id ASC) matches the index
   * (project_id, created_at DESC, id); the cursor is the last item's key.
   */
  async list(
    projectId: string,
    userId: string,
    limit: number = API_CONTRACT.limits.chatMessagesPageMax,
    cursor?: string,
  ): Promise<ChatMessagesPageDto> {
    const after = cursor ? decodeMessageCursor(cursor) : null;
    await this.access.assertCanChat(projectId, userId);
    const params: unknown[] = [projectId, limit + 1];
    let page = '';
    if (after) {
      params.push(after.createdAt, after.id);
      page = `AND (m."created_at" < $3 OR (m."created_at" = $3 AND m."id" > $4))`;
    }
    const rows: MessageRow[] = await this.dataSource.query(
      `SELECT ${MESSAGE_COLUMNS}
         FROM "chat_messages" m
         JOIN "users" u ON u."user_id" = m."user_id"
        WHERE m."project_id" = $1 AND m."deleted_at" IS NULL ${page}
        ORDER BY m."created_at" DESC, m."id" ASC
        LIMIT $2`,
      params,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toMessageDto),
      next_cursor:
        hasMore && last
          ? encodeMessageCursor({
              createdAt: new Date(last.created_at),
              id: last.id,
            })
          : null,
    };
  }

  /** Stores the message, then broadcasts it to the project's room. */
  async send(
    projectId: string,
    userId: string,
    body: string,
  ): Promise<ChatMessageDto> {
    await this.access.assertCanChat(projectId, userId);
    const rows: MessageRow[] = await this.dataSource.query(
      `WITH m AS (
         INSERT INTO "chat_messages" ("id", "project_id", "user_id", "body")
         VALUES ($1, $2, $3, $4)
         RETURNING *)
       SELECT ${MESSAGE_COLUMNS} FROM m JOIN "users" u ON u."user_id" = m."user_id"`,
      [randomUUID(), projectId, userId, body],
    );
    const message = toMessageDto(rows[0]);
    this.rooms.broadcast(projectId, 'message.created', message);
    // FEAT-08a: everyone else's unread count changed (the insert is committed).
    await this.unread.notifyOthers(projectId, userId);
    return message;
  }

  /** Soft delete by the author or the project owner, then broadcast. */
  async remove(
    projectId: string,
    actorId: string,
    messageId: string,
  ): Promise<MessageDeletedDto> {
    const access = await this.access.assertCanChat(projectId, actorId);
    const found: { user_id: string }[] = await this.dataSource.query(
      `SELECT "user_id" FROM "chat_messages"
        WHERE "id" = $1 AND "project_id" = $2 AND "deleted_at" IS NULL`,
      [messageId, projectId],
    );
    if (found.length === 0) throw new NotFoundException(MESSAGE_NOT_FOUND);
    if (!access.isOwner && found[0].user_id !== actorId) {
      throw new ForbiddenException(
        'Only the author or the project owner can delete this message.',
      );
    }
    const [, affected]: [unknown, number] = await this.dataSource.query(
      `UPDATE "chat_messages" SET "deleted_at" = now()
        WHERE "id" = $1 AND "project_id" = $2 AND "deleted_at" IS NULL`,
      [messageId, projectId],
    );
    if (!affected) throw new NotFoundException(MESSAGE_NOT_FOUND);
    const data = { id: messageId, project_id: projectId };
    this.rooms.broadcast(projectId, 'message.deleted', data);
    await this.unread.notifyOthers(projectId, actorId);
    return data;
  }
}
