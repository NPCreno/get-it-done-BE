/**
 * Public chat shapes. Keys are pinned by API_CONTRACT.chat.fields and the
 * integration tests; never spread an entity into a response.
 */
export interface ChatMemberDto {
  user_id: string;
  username: string;
  fullname: string;
}

export interface ChatMembersDto {
  owner: ChatMemberDto;
  members: ChatMemberDto[];
}

export interface SharedProjectDto {
  project_id: string;
  title: string | null;
  color: string | null;
  owner_username: string;
}

export interface ChatMessageDto {
  id: string;
  project_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
}

export interface ChatMessagesPageDto {
  items: ChatMessageDto[];
  next_cursor: string | null;
}

export interface MemberRemovedDto {
  project_id: string;
  user_id: string;
}

export interface MessageDeletedDto {
  id: string;
  project_id: string;
}

export function toMessageDto(row: {
  id: string;
  project_id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: Date | string;
}): ChatMessageDto {
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    username: row.username,
    body: row.body,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** FEAT-08a: GET /api/chat/unread. Only projects with unread > 0; counts capped at API_CONTRACT.chat.unreadCap. */
export interface ChatUnreadItemDto {
  project_id: string;
  unread_count: number;
}

export interface ChatUnreadDto {
  items: ChatUnreadItemDto[];
  total: number;
}

/** FEAT-08a: PUT /api/chat/projects/:project_id/read. */
export interface ChatReadPointDto {
  project_id: string;
  last_read_at: string;
}
