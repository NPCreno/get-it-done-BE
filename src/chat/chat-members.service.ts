import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import {
  ChatAccessService,
  OWNER_ONLY,
  PROJECT_NOT_FOUND,
} from './chat-access.service';
import { ChatRoomsService } from './chat-rooms.service';
import { ChatUnreadService } from './chat-unread.service';
import {
  ChatMemberDto,
  ChatMembersDto,
  MemberRemovedDto,
  SharedProjectDto,
} from './chat.dto';

export const USER_NOT_FOUND = 'User not found';
export const MEMBER_NOT_FOUND = 'Member not found';

@Injectable()
export class ChatMembersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ChatAccessService,
    private readonly rooms: ChatRoomsService,
    private readonly unread: ChatUnreadService,
  ) {}

  /** Owner plus members (soft-deleted users are left out). */
  async list(projectId: string, userId: string): Promise<ChatMembersDto> {
    const { owner_id } = await this.access.assertCanChat(projectId, userId);
    const owner: ChatMemberDto[] = await this.dataSource.query(
      `SELECT "user_id", "username", "fullname" FROM "users" WHERE "user_id" = $1`,
      [owner_id],
    );
    if (owner.length === 0) throw new NotFoundException(PROJECT_NOT_FOUND);
    const members: ChatMemberDto[] = await this.dataSource.query(
      `SELECT u."user_id", u."username", u."fullname"
         FROM "project_members" m
         JOIN "users" u ON u."user_id" = m."user_id"
        WHERE m."project_id" = $1 AND u."deletedAt" IS NULL
        ORDER BY m."created_at", u."username"`,
      [projectId],
    );
    return { owner: owner[0], members };
  }

  /**
   * Owner adds a member by exact username. The project row is locked, so two
   * concurrent adds cannot pass the member limit together.
   */
  async add(
    projectId: string,
    actorId: string,
    username: string,
  ): Promise<ChatMemberDto> {
    return this.dataSource.transaction(async (manager) => {
      const locked: { owner_id: string }[] = await manager.query(
        `SELECT "user_id" AS "owner_id" FROM "project_entity"
          WHERE "project_id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
        [projectId],
      );
      if (locked.length === 0) throw new NotFoundException(PROJECT_NOT_FOUND);
      // 404 for a stranger, 403 for a member.
      await this.access.assertOwner(projectId, actorId, manager);

      const users: ChatMemberDto[] = await manager.query(
        `SELECT "user_id", "username", "fullname" FROM "users"
          WHERE "username" = $1 AND "deletedAt" IS NULL`,
        [username],
      );
      const user = users[0];
      if (!user) throw new NotFoundException(USER_NOT_FOUND);
      if (user.user_id === actorId) {
        throw new BadRequestException('You cannot add yourself.');
      }
      const existing: unknown[] = await manager.query(
        `SELECT 1 FROM "project_members" WHERE "project_id" = $1 AND "user_id" = $2`,
        [projectId, user.user_id],
      );
      if (existing.length > 0) throw new ConflictException('Already a member.');
      const [{ count }]: { count: number }[] = await manager.query(
        `SELECT count(*)::int AS "count" FROM "project_members" WHERE "project_id" = $1`,
        [projectId],
      );
      const max = API_CONTRACT.limits.chatMembersMax;
      if (count >= max) {
        throw new BadRequestException(
          `A project can have at most ${max} members.`,
        );
      }
      await manager.query(
        `INSERT INTO "project_members" ("project_id", "user_id", "added_by")
         VALUES ($1, $2, $3)`,
        [projectId, user.user_id, actorId],
      );
      return user;
    });
  }

  /** The owner removes anyone; a member may remove only themself (leave). */
  async remove(
    projectId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<MemberRemovedDto> {
    const access = await this.access.assertCanChat(projectId, actorId);
    if (!access.isOwner && targetUserId !== actorId) {
      throw new ForbiddenException(OWNER_ONLY);
    }
    // The read point goes with the membership (FEAT-08a), so a re-added member
    // starts again from their new join time.
    await this.dataSource.transaction(async (manager) => {
      const [, affected]: [unknown, number] = await manager.query(
        `DELETE FROM "project_members" WHERE "project_id" = $1 AND "user_id" = $2`,
        [projectId, targetUserId],
      );
      if (!affected) throw new NotFoundException(MEMBER_NOT_FOUND);
      await manager.query(
        `DELETE FROM "chat_reads" WHERE "project_id" = $1 AND "user_id" = $2`,
        [projectId, targetUserId],
      );
    });
    // After the commit: the removed user's sockets leave the room, and their
    // badge for this project goes away.
    this.rooms.kick(projectId, targetUserId);
    this.unread.notify([targetUserId], projectId);
    return { project_id: projectId, user_id: targetUserId };
  }

  /** Projects shared with the user (not their own), newest share first. */
  async sharedWith(userId: string): Promise<SharedProjectDto[]> {
    return this.dataSource.query(
      `SELECT p."project_id", p."title", p."color", o."username" AS "owner_username"
         FROM "project_members" m
         JOIN "project_entity" p
           ON p."project_id" = m."project_id" AND p."deletedAt" IS NULL
         JOIN "users" o ON o."user_id" = p."user_id"
        WHERE m."user_id" = $1
        ORDER BY m."created_at" DESC, p."project_id"`,
      [userId],
    );
  }
}
