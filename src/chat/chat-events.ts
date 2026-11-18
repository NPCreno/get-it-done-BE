/**
 * FEAT-08a: chat tells the notifications stream that someone's unread counts
 * changed. Emitted through the global EventEmitter2 so ChatModule and
 * NotificationsModule don't import each other. Carries no message text and no
 * counts: the FE refetches GET /api/chat/unread, the source of truth.
 */
export const CHAT_UNREAD_CHANGED = 'chat.unread.changed';

export interface ChatUnreadChangedEvent {
  userIds: string[];
  projectId: string;
}

/**
 * Who gets a `chat` event when a message is created or deleted: the owner and
 * every member, minus the actor, each once. Pure, unit tested.
 */
export function unreadRecipients(
  ownerId: string,
  memberIds: readonly string[],
  actorId: string,
): string[] {
  return [...new Set([ownerId, ...memberIds])].filter(
    (id) => typeof id === 'string' && id !== '' && id !== actorId,
  );
}
