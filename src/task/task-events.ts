import type { NotificationsEntity } from 'src/notifications/models/notifications.entity';
import { unreadRecipients } from 'src/chat/chat-events';

/**
 * FEAT-09a (D3): a task in a shared project changed. Emitted after the commit
 * by every task write on a task with a project (create, edit, status, assignee,
 * delete, subtask writes, a member's removal). NotificationsService sends a
 * small `tasks` SSE event (`{project_id}`) to the owner and members minus the
 * actor; the FE refetches. No task text, no notification row.
 */
export const TASKS_CHANGED = 'tasks.changed';

export interface TasksChangedEvent {
  projectId: string;
  actorId: string;
  /** Also told, though no longer a member (a removed member). */
  alsoNotify?: string[];
}

/**
 * Who gets the `tasks` event: the owner and the members minus the actor, plus
 * `alsoNotify` minus the actor, each once. A project with no members, changed
 * by its owner, tells nobody. `ownerId` null = the project is gone. Pure.
 */
export function tasksEventRecipients(
  ownerId: string | null,
  memberIds: readonly string[],
  actorId: string,
  alsoNotify: readonly string[] = [],
): string[] {
  const base = ownerId ? unreadRecipients(ownerId, memberIds, actorId) : [];
  const extra = alsoNotify.filter(
    (id) => typeof id === 'string' && id !== '' && id !== actorId,
  );
  return [...new Set([...base, ...extra])];
}

/**
 * FEAT-09a (D4): a notification row was committed outside NotificationsModule
 * (the task assignment); NotificationsService pushes it on the user's stream.
 */
export const NOTIFICATION_CREATED = 'notification.created';

export interface NotificationCreatedEvent {
  userId: string;
  notification: NotificationsEntity;
}

/** Title of the assignment notification (D4). */
export const ASSIGNMENT_TITLE = 'New task assigned';
const TASK_TITLE_MAX = 80;

/**
 * `<actor> assigned you "<task>" in <project>`, the task title cut at 80
 * characters. Pure, unit tested.
 */
export function assignmentMessage(
  actorUsername: string,
  taskTitle: string,
  projectTitle: string | null,
): string {
  const title =
    taskTitle.length > TASK_TITLE_MAX
      ? `${taskTitle.slice(0, TASK_TITLE_MAX - 1)}…`
      : taskTitle;
  return `${actorUsername} assigned you "${title}" in ${projectTitle || 'Untitled Project'}`;
}
