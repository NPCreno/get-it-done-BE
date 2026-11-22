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
    // FEAT-09a: "<username> assigned you "<task>" in <project>"
    'assignment',
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
    tokenNameMax: 60,
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
    chatUnread: '/chat/unread',
    chatMarkRead: '/chat/projects/:project_id/read',
    tokensList: '/tokens',
    tokenCreate: '/tokens',
    tokenRevoke: '/tokens/:id',
    oauthAuthorizeCheck: '/oauth/authorize/check',
    oauthAuthorize: '/oauth/authorize',
    oauthGrantsList: '/oauth/grants',
    oauthGrantRevoke: '/oauth/grants/:id',
    // FEAT-09a: PATCH {assignee_id: string | null} -> {status, data: task row}
    taskAssignee: '/tasks/:task_id/assignee',
  },
  /**
   * Project colors the website offers (label -> hex). The MCP create_project
   * tool takes a label and stores both, like the website's color picker.
   */
  projectColors: [
    { label: 'Lavender', hex: '#E6E6FA' },
    { label: 'Mint', hex: '#B5EAD7' },
    { label: 'Peach', hex: '#FFDAB9' },
    { label: 'Sky', hex: '#A0D8EF' },
    { label: 'Lemon', hex: '#FFFACD' },
    { label: 'Rose', hex: '#FADADD' },
    { label: 'Mauve', hex: '#E0B0FF' },
    { label: 'Baby Blue', hex: '#BDE0FE' },
    { label: 'Coral', hex: '#FFB5A7' },
    { label: 'Seafoam', hex: '#C3FBD8' },
  ],
  /**
   * Personal access tokens (FEAT-07a). Valid only on the MCP endpoint, never
   * on the REST API. REST responses are `{ status: 'success', data }`; the
   * secret (`token`) appears only in the create response.
   */
  tokens: {
    prefix: 'gid_pat_',
    expiresInDays: [30, 90, 365],
    defaultExpiresInDays: 90,
    maxActive: 10,
    createsPerHour: 10,
    statuses: ['active', 'expired', 'revoked'],
    // Server path at the API ORIGIN, not under /api: strip a trailing /api
    // from NEXT_PUBLIC_API_URL before appending it.
    mcpPath: '/mcp',
    fields: {
      token: [
        'id',
        'name',
        'prefix',
        'created_at',
        'last_used_at',
        'expires_at',
        'revoked_at',
        'status',
      ],
      createdToken: [
        'id',
        'name',
        'prefix',
        'created_at',
        'last_used_at',
        'expires_at',
        'revoked_at',
        'status',
        'token',
      ],
    },
  },
  /**
   * OAuth for MCP connectors (FEAT-07c): claude.ai, the Claude apps, Claude
   * Code and other MCP clients sign in through the website's consent page
   * (`authorizePath` on the FE origin) and get opaque tokens valid only on
   * /mcp. The consent page calls `routes.oauthAuthorizeCheck` and
   * `routes.oauthAuthorize` with the website JWT; "Connected apps" uses
   * `routes.oauthGrantsList` / `oauthGrantRevoke`. Responses are
   * `{ status: 'success', data }`. The check always answers 200 with `data`
   * a union on `outcome` (`checkOutcomes`): `ok` (`fields.authorizeCheck`),
   * `redirect` (`fields.authorizeCheckRedirect`: navigate to `redirect_to`,
   * which carries `error=`), `fatal` (`fields.authorizeCheckFatal`: show it,
   * never redirect). The decision answers 200 `{ redirect_to }` for allow,
   * deny and redirectable problems, and 400 `fields.authorizeError` (always
   * `fatal: true`) for the fatal ones. Any other non-2xx is fatal too.
   */
  oauth: {
    // The FE page that is the OAuth authorization endpoint (on FRONTEND_URL).
    authorizePath: '/oauth/authorize',
    scopes: ['mcp', 'offline_access'],
    defaultScope: 'mcp',
    accessTokenPrefix: 'gid_oat_',
    refreshTokenPrefix: 'gid_ort_',
    clientIdPrefix: 'gid_cli_',
    accessTokenSeconds: 3600,
    refreshTokenDays: 30,
    grantMaxDays: 180,
    codeSeconds: 60,
    refreshRetryGraceSeconds: 60,
    redirectUrisMax: 5,
    clientNameMax: 100,
    defaultClientName: 'Unnamed app',
    registersPerHour: 20,
    tokenRequestsPerMinute: 60,
    authorizePerMinute: 30,
    decisions: ['allow', 'deny'],
    checkOutcomes: ['ok', 'redirect', 'fatal'],
    // Query parameters of the authorize request, passed through unchanged by
    // the consent page (check: query string; decision: JSON body + decision).
    authorizeParams: [
      'response_type',
      'client_id',
      'redirect_uri',
      'code_challenge',
      'code_challenge_method',
      'scope',
      'state',
      'resource',
    ],
    fields: {
      authorizeCheck: [
        'outcome',
        'client_name',
        'redirect_host',
        'loopback_only',
        'scopes',
      ],
      authorizeCheckRedirect: ['outcome', 'error', 'redirect_to'],
      authorizeCheckFatal: ['outcome', 'error'],
      authorizeDecision: ['redirect_to'],
      // The decision's 400 body (fatal only).
      authorizeError: ['statusCode', 'error', 'message', 'fatal'],
      grant: [
        'id',
        'client_name',
        'redirect_host',
        'created_at',
        'last_used_at',
      ],
    },
  },
  /**
   * Shared tasks (FEAT-09a). The project owner and every member add, edit,
   * assign and complete the project's tasks; the owner deletes any, a member
   * only their own (`can_delete`). "My tasks" and every dashboard stat follow
   * the responsible person, COALESCE(assignee_id, user_id); `user_id` is the
   * creator.
   */
  tasks: {
    // Event type on the notifications SSE stream (/notifications/sse) when a
    // task in a shared project changed. Data {"project_id"} (fields.tasksEvent),
    // no notification id, no task text. Refetch the project's tasks and
    // getTasksByUser on it.
    sseEventType: 'tasks',
    fields: {
      // Added to every row of getTasksByUser, getTasksByProj and the
      // assignee route (all additions; old fields unchanged).
      sharing: [
        'user_id',
        'creator_username',
        'assignee_id',
        'assignee_username',
        'can_delete',
      ],
      // getTasksByUser rows and the assignee route's row also carry these.
      userRowExtra: [
        'project_id',
        'project_title',
        'project_owner_username',
        'template_id',
        'subInstances',
      ],
      assigneeBody: ['assignee_id'],
      tasksEvent: ['project_id'],
    },
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
    // FEAT-08a: per-project unread counts stop here (the FE shows "99+").
    unreadCap: 100,
    // FEAT-08a: event type on the notifications SSE stream
    // (/notifications/sse) when the user's chat unread counts changed. Its
    // data is {"project_id"} (fields.unreadEvent). It carries no notification
    // id: Nest numbers id-less frames itself (like `ping`), so Last-Event-ID is
    // not a notification id and is not used. Refetch chatUnread on it.
    sseEventType: 'chat',
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
      unread: ['items', 'total'],
      unreadItem: ['project_id', 'unread_count'],
      readPoint: ['project_id', 'last_read_at'],
      unreadEvent: ['project_id'],
    },
  },
} as const;

export type ApiContract = typeof API_CONTRACT;
