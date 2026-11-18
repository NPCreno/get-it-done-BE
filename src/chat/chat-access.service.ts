import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export const PROJECT_NOT_FOUND = 'Project not found';
export const OWNER_ONLY = 'Only the project owner can do this.';
export const MESSAGE_NOT_FOUND = 'Message not found';

export interface ChatAccess {
  project_id: string;
  owner_id: string;
  isOwner: boolean;
}

interface AccessRow {
  project_id: string;
  owner_id: string;
  is_member: boolean;
}

/**
 * Who may use a project's chat: its owner or a member, while the project is
 * not deleted. A stranger gets the same 404 as a missing project, so the API
 * does not reveal which projects exist.
 */
@Injectable()
export class ChatAccessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async assertCanChat(
    projectId: string,
    userId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ChatAccess> {
    const rows: AccessRow[] = await manager.query(
      `SELECT p."project_id", p."user_id" AS "owner_id",
              (m."user_id" IS NOT NULL) AS "is_member"
         FROM "project_entity" p
         LEFT JOIN "project_members" m
           ON m."project_id" = p."project_id" AND m."user_id" = $2
        WHERE p."project_id" = $1 AND p."deletedAt" IS NULL`,
      [projectId, userId],
    );
    return decideAccess(rows[0], userId);
  }

  /** Owner only. A member gets 403 (they know the project); a stranger 404. */
  async assertOwner(
    projectId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ChatAccess> {
    const access = await this.assertCanChat(projectId, userId, manager);
    if (!access.isOwner) throw new ForbiddenException(OWNER_ONLY);
    return access;
  }
}

/** Pure decision, unit tested. */
export function decideAccess(
  row: AccessRow | undefined,
  userId: string,
): ChatAccess {
  if (!row || typeof userId !== 'string' || userId === '') {
    throw new NotFoundException(PROJECT_NOT_FOUND);
  }
  const isOwner = row.owner_id === userId;
  if (!isOwner && row.is_member !== true) {
    throw new NotFoundException(PROJECT_NOT_FOUND);
  }
  return { project_id: row.project_id, owner_id: row.owner_id, isOwner };
}
