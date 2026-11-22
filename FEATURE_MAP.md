# Feature Map — Backend

Endpoint → implementing chain. All routes are under `/api`. "Guarded" means `AuthorizeGuard`.

## Auth
- `POST /api/auth/refresh` → `AuthController.refreshToken` → `AuthService.refresh` (row lock, rotate or grace replay, 401 `REFRESH_INVALID` / `REFRESH_REUSED`). IP comes from `getClientIp(req)` (attested by `X-Internal-Secret`); a client-sent `ipAddress` body field is ignored.
- `POST /api/auth/logout` → `AuthController.logout` → `AuthService.logout` (revokes the token family, always 204).

## User
- `POST /api/user/create` → `UserController.create` → `UserService.createUser`
- `POST /api/user/loginEmail` (email matched case-insensitively and trimmed: `lower(email) = normalizeEmail(input)`, BUG-01) → `UserController.loginEmail` → `UserService.loginEmail` → `AuthService.generateAccessToken` + `generateRefreshToken`. IP from `getClientIp(req)`.
- `POST /api/user/loginUsername` → same chain through `UserService.loginUsername`
- Guarded: `GET get/:id`, `GET getAll`, `DELETE :id`, `DELETE :id/hard`, `PATCH update/:user_id`. `get/:id` allows only the token owner or an admin.

## Projects (all guarded)
- `GET getAll`, `GET getAll/:user_id`, `GET :project_id`, `POST create`, `PATCH :project_id`, `DELETE :project_id`, `DELETE :project_id/hard` → `ProjectsController` → `ProjectsService`

## Tasks (all guarded) → `TaskController` → `TaskService` (writes), `TaskQueryService`, `SubTaskService`, `TaskStatusService`, `TaskStatsService`, `TaskStreakService`, `TaskRecurrenceService`
- Create: `POST create`, `POST bulk-create`, `POST createSubTask`, `POST bulk-create-subtasks`
- Read: `GET getTasksByUser/:user_id`, `GET getTasksByProj/:project_id`
- Update: `PATCH :task_id`, `PATCH update-task-status/:task_id/status/:status`, `PATCH update-subtask-status/:taskSubInstance_id/status/:status` (status checked by `StatusValidationPipe`)
- Delete: `DELETE :task_id`, `DELETE :task_id/hard`, `DELETE /subTask/:subTask_id`, `DELETE deleteRecurringTasks/:taskTemplate_id`
- Analytics: `GET getDashboardData/:user_id`, `GET completion-trend/:user_id`, `GET task-distribution/:user_id`, `GET calendar-heatmap/:user_id`, `GET streak/:user_id`
- Assign (FEAT-09a): `PATCH :task_id/assignee {assignee_id: string | null}` → `TaskAssignService.setAssignee` → `{status: 'success', data: <getTasksByUser row>}`

## Shared tasks (FEAT-09a) → `TaskAccessService` (one access check), `task-scope.ts` (shared SQL)
- Who: a task without a project is its creator's only. In a project, the owner (also after a soft delete) and every current member (while the project is not deleted) add, edit, assign and complete any task and its sub-tasks. Delete: the owner any task, a member only tasks they created (403 `Only the project owner or the task's creator can delete it.`); a sub-task: the owner, the parent's creator or the sub-task's creator. Moving a task (`setProject`, MCP `update_task project_id`) is for its creator only, into a project they own or are a member of, and clears the assignee. Recurring delete: the template's creator or the project owner
- Strangers get the same 404 as a missing item (`Task not found`, `Project not found`, `Subtask not found`), as real HTTP errors also on the envelope routes (`rethrowAccess`); `getTasksByProj` is 404 for a stranger (was `[]`)
- "My tasks" (`getTasksByUser`, dashboard, trend, distribution, heatmap, streak, MCP `list_tasks` without a project) = `COALESCE(assignee_id, user_id) = me` AND accessible. Distribution groups my responsible completed tasks by the projects I own or am a member of. A completion credits the responsible person (lifetime counter, `task.completed` awards)
- Rows of `getTasksByUser`, `getTasksByProj` and the assignee route add `user_id` (creator), `creator_username`, `assignee_id`, `assignee_username`, `can_delete`; `getTasksByUser` and the assignee route also `project_owner_username` (`API_CONTRACT.tasks.fields`)
- Assignee: the project owner or a current member (400 `Assignee must be a member of this project.`); only tasks in a project (400 `Only a task in a project can be assigned.`); not at recurring create (400). `POST create` takes an optional `assignee_id` (counts as an assignment)
- Notification (D4): a real change to someone other than the actor inserts `type: 'assignment'`, title `New task assigned`, message `<actor> assigned you "<task, 80 chars>" in <project>`, `actionType: 'acknowledge'`, in the same transaction; pushed on the SSE stream after the commit (`notification.created`). Unassign, same assignee and self-assignment send none
- Live (D3): every task write on a task with a project emits `tasks.changed` after the commit; `NotificationsService` sends SSE `event: tasks`, data `{project_id}` to the owner and members minus the actor (a removed member too)
- Member removal (`DELETE /api/chat/projects/:id/members/:user_id`): in the same transaction, every task in the project the member was responsible for gets `assignee_id = <owner>`

## Validation and identity (DATA-02)
- Every create endpoint ignores a client `user_id`; the owner is the token `sub` (`@AuthUserId()`), and `project_id` must belong to the caller.
- `PATCH /api/user/update/:user_id` maps `fullname`, `username`, `password`, `theme`, `enableNotifications`, `soundFx` only; a changed password is hashed; a duplicate username is `409`.
- `GET /api/notifications`, `PATCH /api/notifications/read-all`, `PATCH /api/notifications/:notif_id/read`, `GET /api/notifications/sse` and `DELETE /api/notifications/clear/:user_id` require a token and are scoped to it. List items: `notif_id, type, title, message, read, actionType, createdAt`. The stream sends `event: notification` (`id:` = notif_id) after commit, a `ping` every 25 s, and closes at the token's expiry; clients refetch the list on reconnect.

## Recurring tasks
- `TaskGeneratorService` `@Cron('0 0 * * *')` creates `TaskInstanceEntity` rows from `TaskTemplateEntity` every day at midnight.

## Notifications
- `TaskStatusService` emits `task.completed` (user = the task's responsible person, FEAT-09a) → `NotificationsService` `@OnEvent('task.completed')` creates a notification → streamed over `GET /api/notifications/sse`
- Award rules (each award is given once): `updateTaskStatus` changes the status only when it differs (`IS DISTINCT FROM`), and on a transition to Complete increments `users.lifetime_completed_count` in the same transaction (never decremented), then emits `task.completed {userId, taskId, lifetimeCount}` after commit. The listener maps each matching rule to an award key (`src/notifications/award-key.ts`) and inserts it into `user_awards` with the notification in one transaction; SSE is sent only for a newly inserted key.
  - `equals: n` on the lifetime count → `<type>:eq:<n>` (once ever); `every: n` → `<type>:every:<n>:<count>` (once per multiple); streak `equals: n` → `streak:eq:<n>:<run start date>` (once per streak run; a new run after a break can notify again)
  - `{count}` in messages is the lifetime count. The dashboard `complete_tasks` stat still counts current completed tasks
  - Migration `AwardOnce` backfills the counter from current completed tasks and the ledger from surviving notification rows by exact `(type, title)` (streak and `taskDue` rows are not backfilled). Users below their historic peak may receive some milestones once more after the migration; the ledger prevents repeats afterwards
  - Known gap (no outbox): a crash between the status commit and the listener, or a listener DB error, loses that award without retry
- `DELETE /api/notifications/clear/:user_id` clears a user's notifications. It does not touch `user_awards`.

## Project chat (FEAT-05, all guarded) → `ChatController` → `ChatMembersService`, `ChatMessagesService`, both behind `ChatAccessService.assertCanChat`
- Responses are `{status: 'success', data}`. A stranger, a missing project and a soft-deleted project are the same 404 `Project not found`; a member doing an owner-only action gets 403.
- `GET /api/chat/projects/:project_id/members` (owner or member) → `{owner, members}`, each `{user_id, username, fullname}`
- `POST /api/chat/projects/:project_id/members {username}` (owner; `@RateLimit('chatMember')`, 60/h per user) → 201 member. Exact username; unknown user 404 `User not found`; 409 already a member; 400 self or 20 members. The project row is locked for the add
- `DELETE /api/chat/projects/:project_id/members/:user_id` (owner, or the member leaving) → `{project_id, user_id}`; then `ChatRoomsService.kick`
- `GET /api/chat/shared-projects` → `[{project_id, title, color, owner_username}]`
- `GET /api/chat/projects/:project_id/messages?limit&cursor` → `{items, next_cursor}`, newest first by `(created_at DESC, id)`, limit ≤ 50, opaque cursor
- `POST /api/chat/projects/:project_id/messages {body}` (`@RateLimit('chatMessage')`, 30/min per user) → 201 message `{id, project_id, user_id, username, body, created_at}`; broadcast `message.created`
- `DELETE /api/chat/projects/:project_id/messages/:id` (author or owner) → soft delete, `{id, project_id}`; broadcast `message.deleted`
- `GET /api/chat/unread` (FEAT-08a, `ChatUnreadService.unread`) → `{items: [{project_id, unread_count}], total}`. Only projects with unread > 0; each count capped at 100 (`API_CONTRACT.chat.unreadCap`, the FE shows "99+"); `total` is the sum of the capped counts. Unread = not deleted, not the caller's, newer than the later of the caller's `chat_reads.last_read_at` and (for a member) their join time; soft-deleted projects drop out
- `PUT /api/chat/projects/:project_id/read {message_id}` (FEAT-08a; uuid, a deleted message counts) → `{project_id, last_read_at}`. Upsert with `GREATEST`, never moves back, idempotent. A stranger 404 `Project not found`; a message not in this project 404 `Message not found`
- SSE `event: chat` on `GET /api/notifications/sse` (FEAT-08a): data `{project_id}`, no notification id (Nest numbers the frame, as it does `ping`). Sent after the write to the owner and members minus the actor on message create/delete, to the reader on mark-read, and to a removed member. Refetch `GET /api/chat/unread`; no counts or text in the event. Removing a member also deletes their `chat_reads` row
- WebSocket `/api/chat/ws` (`ChatGateway`): Origin must be `FRONTEND_URL` (else 403 on upgrade); first frame `{type:'auth', token}` within 5 s, checked by `verifyAccessToken`; `join`/`leave` with `project_id`. Server frames `{type, data}`: `ready`, `joined`, `left`, `removed`, `message.created`, `message.deleted`, `error {code}`. Close 4401 on missing/bad auth and at token expiry. Receive only; rooms in memory (one instance)

## Personal access tokens (FEAT-07a, website JWT) → `TokensController` → `TokensService`
- `GET /api/tokens` → `[{id, name, prefix, created_at, last_used_at, expires_at, revoked_at, status}]`, newest first, every status (`active`/`expired`/`revoked`). Never a hash or secret
- `POST /api/tokens {name (trimmed, 1-60), expires_in_days: 30|90|365|null}` (omitted = 90; `@RateLimit('tokenCreate')`, 10/h per user) → 201 `{...token, token: 'gid_pat_…'}`, the only time the secret leaves the server. 11th active token → 400 `You can have at most 10 active tokens.`
- `DELETE /api/tokens/:id` → revoke (`revoked_at`, kept on repeat); a missing, foreign or non-uuid id → 404 `Token not found`
- All three: `Cache-Control: no-store`

## OAuth for MCP connectors (FEAT-07c) → `src/oauth/`
Discovery and client endpoints (no `/api`, CORS `*`, `no-store` except metadata):
- `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-protected-resource` → `{resource, authorization_servers: [issuer], scopes_supported: ['mcp','offline_access'], bearer_methods_supported: ['header']}` (`OAuthMetadataController`, no DB, `max-age=300`)
- `GET /.well-known/oauth-authorization-server` → RFC 8414 (`authorization_endpoint` = FE `/oauth/authorize`; token, registration, revocation on the BE; S256; `none`)
- `POST /oauth/register` (JSON, `@RateLimit('oauthRegister')` 20/h per client key + 200/h global) → 201 `{client_id: 'gid_cli_…', client_id_issued_at, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method: 'none'}`; 400 `invalid_redirect_uri` / `invalid_client_metadata` (`OAuthClientsService`)
- `POST /oauth/token` (form; `@RateLimit('oauthToken')` 60/min per `client_id` + 600/min global) → `{access_token: 'gid_oat_…', token_type: 'Bearer', expires_in: 3600, refresh_token: 'gid_ort_…', scope}`; errors `invalid_request`, `invalid_client` (401), `invalid_grant`, `invalid_target`, `invalid_scope`, `unsupported_grant_type` (`OAuthTokenService`)
- `POST /oauth/revoke` (form, RFC 7009) → always 200; an access token alone, a refresh token ends its grant

Website side (website JWT, `AuthorizeGuard`, `no-store`) → `OAuthApiController`:
- `GET /api/oauth/authorize/check?<authorize params>` → always 200 `{status, data}`, `data` a union on `outcome`: `{outcome: 'ok', client_name, redirect_host, loopback_only, scopes}`, `{outcome: 'redirect', error, redirect_to}` (navigate there; it carries `error=`, `state`, `iss`) or `{outcome: 'fatal', error}` (unknown client, unregistered redirect URI: show, never redirect). A non-2xx (401, a ValidationPipe 400) is fatal too
- `POST /api/oauth/authorize {…authorize params, decision: 'allow'|'deny'}` (`@RateLimit('oauthAuthorize')` 30/min per user) → `{status, data: {redirect_to}}` (allow: `code`, `state`, `iss`; deny: `error=access_denied`, `state`, `iss`)
- Decision: allow, deny and redirectable problems → 200 `{redirect_to}` (a problem carries `error=`, no code, no grant). Fatal → 400 `{statusCode: 400, error, message, fatal: true}`
- `GET /api/oauth/grants` → `{status, data: [{id, client_name, redirect_host, created_at, last_used_at}]}` (working grants only, newest first)
- `DELETE /api/oauth/grants/:id` → `{status, data: grant}`; revokes the grant and all its tokens; idempotent; missing/foreign/non-uuid → 404 `Connected app not found`

## MCP server (FEAT-07a) → `ALL /mcp` → `McpController` → `McpServerFactory` → tools in `src/mcp/tools/`
Auth: personal access token (`Bearer gid_pat_…`) or OAuth access token (`Bearer gid_oat_…`, FEAT-07c) through `requireBearerAuth` + `McpTokenVerifier`. 401s carry `resource_metadata`. Origin check (403), rate limit 120/min per token or grant (429). See `CLAUDE.md` (MCP) and `docs/MCP.md`.

| Tool | Hint | Services |
|---|---|---|
| `get_profile` | read-only | `UserService.findOne` |
| `get_dashboard` (`from?`, `to?`, default today UTC) | read-only | `TaskStatsService.getDashboardData`, `TaskStreakService.getStreakCount` |
| `list_notifications` (`unread_only?`, `limit?`) | read-only | `NotificationsService.list` |
| `mark_notification_read` | idempotent | `NotificationsService.markRead` |
| `list_tasks` (`status?`, `project_id?`, `due_from?`, `due_to?`, `search?`, `include_completed?`, `limit?`) | read-only | `TaskQueryService.listOwnTasks` (FEAT-09a: responsible + accessible; with `project_id` every task of that project), `subtaskCounts` |
| `get_task` | read-only | `TaskQueryService.findOwnTask` (any task the caller may work on), `subtasksOf` |
| `create_task` (+ recurrence) | write | `CreateTaskDto` rules → `TaskService.createTask` |
| `update_task` (`project_id` null clears) | idempotent | `UpdateTaskDto` rules → `TaskService.updateOne`, `TaskService.setProject` |
| `set_task_status` | idempotent | `TaskStatusService.updateTaskStatus` (awards, `task.completed`) |
| `add_subtask` | write | `CreateTaskSubInstanceDto` rules → `SubTaskService.createTaskSubInstance` |
| `set_subtask_status` | idempotent | `TaskStatusService.updateSubTaskStatus` |
| `delete_task`, `delete_subtask` | destructive (soft) | `TaskService.softDeleteOne`, `SubTaskService.softDeleteSubTask` |
| `list_projects`, `get_project` | read-only | `ProjectsService.listWithCounts` (one aggregate), `TaskQueryService.listOwnTasks` |
| `create_project`, `update_project` (color = palette label) | write / idempotent | `CreateProjectDto`/`UpdateProjectDto` rules → `ProjectsService` |
| `delete_project` | destructive (soft) | `ProjectsService.softDeleteOne` |
| `list_shared_projects`, `list_chat_messages` (limit ≤ 50), `get_chat_unread` | read-only | `ChatMembersService.sharedWith`, `ChatMessagesService.list` (`assertCanChat`), `ChatUnreadService.unread` |

