/**
 * Canonical API contract. DTO decorators import these values, and
 * `pnpm contract:export` writes them to docs/api-contract.json, which the
 * frontend vendors. Changing anything here means: run contract:export, then
 * contract:sync in the FE repo.
 */
export const API_CONTRACT = {
  version: 1,
  taskPriorities: ['Low', 'Medium', 'High'],
  taskStatuses: ['Pending', 'Complete', 'Overdue'],
  newTaskStatuses: ['Pending', 'Complete'],
  repeatEvery: ['Day', 'Week', 'Month'],
  weekdays: [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ],
  themes: ['light', 'dark'],
  booleanStrings: ['true', 'false'],
  notificationTypes: [
    'achievement',
    'milestone',
    'streak',
    'levelUp',
    'reward',
    'taskDue',
  ],
  limits: {
    fullnameMin: 3,
    fullnameMax: 50,
    usernameMin: 3,
    usernameMax: 20,
    passwordMin: 6,
    passwordMax: 20,
    titleMin: 2,
    titleMax: 100,
    descriptionMax: 500,
    colorLabelMax: 50,
    notificationsPageMax: 100,
    chatMessageMax: 2000,
    chatMessagesPageMax: 50,
    chatMembersMax: 20,
  },
  patterns: {
    username: '^[A-Za-z0-9_]+$',
    password: '[0-9]',
  },
  // Paths the FE calls, relative to NEXT_PUBLIC_API_URL (which ends in /api).
  routes: {
    taskStatus: '/tasks/update-task-status/:task_id/status/:status',
    subTaskStatus:
      '/tasks/update-subtask-status/:taskSubInstance_id/status/:status',
    notificationsList: '/notifications',
    notificationRead: '/notifications/:notif_id/read',
    notificationsReadAll: '/notifications/read-all',
    chatMembersList: '/chat/projects/:project_id/members',
    chatMemberAdd: '/chat/projects/:project_id/members',
    chatMemberRemove: '/chat/projects/:project_id/members/:user_id',
    chatSharedProjects: '/chat/shared-projects',
    chatMessagesList: '/chat/projects/:project_id/messages',
    chatMessageSend: '/chat/projects/:project_id/messages',
    chatMessageDelete: '/chat/projects/:project_id/messages/:id',
  },
  /**
   * Project chat (FEAT-05). REST responses are `{ status: 'success', data }`.
   * The socket only receives; sending goes through REST.
   */
  chat: {
    // Relative to NEXT_PUBLIC_API_URL, like `routes` (the server path is /api/chat/ws).
    wsPath: '/chat/ws',
    authTimeoutMs: 5000,
    closeCodes: { unauthorized: 4401 },
    messagesPerMinute: 30,
    maxRoomsPerSocket: 50,
    // Client -> server frames: {"type":"auth","token"}, {"type":"join","project_id"}, {"type":"leave","project_id"}
    clientFrames: ['auth', 'join', 'leave'],
    // Server -> client frames: {"type", "data"}; message.created data is a
    // `message`, message.deleted data is {id, project_id}, the same as REST.
    serverEvents: [
      'ready',
      'joined',
      'left',
      'removed',
      'message.created',
      'message.deleted',
      'error',
    ],
    errorCodes: ['NOT_FOUND', 'BAD_FRAME', 'TOO_MANY_ROOMS'],
    // Exact keys of each response object.
    fields: {
      member: ['user_id', 'username', 'fullname'],
      members: ['owner', 'members'],
      sharedProject: ['project_id', 'title', 'color', 'owner_username'],
      message: [
        'id',
        'project_id',
        'user_id',
        'username',
        'body',
        'created_at',
      ],
      messagesPage: ['items', 'next_cursor'],
      memberRemoved: ['project_id', 'user_id'],
      messageDeleted: ['id', 'project_id'],
    },
  },
} as const;

export type ApiContract = typeof API_CONTRACT;
