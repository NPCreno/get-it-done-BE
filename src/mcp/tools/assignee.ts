import { BadRequestException } from '@nestjs/common';
import * as z from 'zod/v4';
import { API_CONTRACT } from 'src/common/api-contract';
import type { ChatMembersDto } from 'src/chat/chat.dto';
import {
  ASSIGN_NEEDS_PROJECT,
  ASSIGNEE_NOT_MEMBER,
} from 'src/task/task-access.service';
import type { McpDeps } from '../mcp-tool';

/** FEAT-07e: create_task refuses an assignee on a recurring series. */
export const RECURRING_STARTS_UNASSIGNED = 'Recurring tasks start unassigned.';

/** The caller, in an `assignee` input. */
export const ME = 'me';

/** A username from list_project_members, or "me" (FEAT-07e). */
export const assigneeInput = z
  .string()
  .min(1)
  .max(API_CONTRACT.limits.usernameMax)
  .describe(
    'Who is responsible: a username from list_project_members (the project owner or a member), or "me".',
  );

/**
 * Turns an `assignee` input into a user id, looking only at the project's
 * owner and members (never other users). "me" is the caller. An unknown
 * username and someone outside the project get the same 400 as the website's
 * non-member id. Pure; unit-tested.
 */
export function pickAssignee(
  people: ChatMembersDto,
  assignee: string,
  callerId: string,
): string {
  if (assignee === ME) return callerId;
  const match = [people.owner, ...people.members].find(
    (p) => p.username === assignee,
  );
  if (!match) throw new BadRequestException(ASSIGNEE_NOT_MEMBER);
  return match.user_id;
}

/**
 * The assignee's user id for a task in `projectId`, or null to unassign.
 * Listing the people goes through the chat access rule (owner or member),
 * so a stranger gets the usual "Project not found".
 */
export async function resolveAssignee(
  deps: McpDeps,
  callerId: string,
  projectId: string,
  assignee: string | null,
): Promise<string | null> {
  if (assignee === null) return null;
  if (assignee === ME) return callerId;
  const people = await deps.chatMembers.list(projectId, callerId);
  return pickAssignee(people, assignee, callerId);
}

/** create_task: an assignee needs a project and a one-off task. Pure. */
export function checkCreateAssignee(a: {
  assignee?: string;
  project_id?: string;
  is_recurring?: boolean;
}): void {
  if (a.assignee === undefined) return;
  if (a.is_recurring)
    throw new BadRequestException(RECURRING_STARTS_UNASSIGNED);
  if (!a.project_id) throw new BadRequestException(ASSIGN_NEEDS_PROJECT);
}
