# Feature Map — Backend

Endpoint → implementing chain. All routes are under `/api`. "Guarded" means `AuthorizeGuard`.

## Auth
- `POST /api/auth/refresh` → `AuthController.refreshToken` → `AuthService.refresh` (row lock, rotate or grace replay, 401 `REFRESH_INVALID` / `REFRESH_REUSED`). IP comes from `getClientIp(req)` (attested by `X-Internal-Secret`); a client-sent `ipAddress` body field is ignored.
- `POST /api/auth/logout` → `AuthController.logout` → `AuthService.logout` (revokes the token family, always 204).

## User
- `POST /api/user/create` → `UserController.create` → `UserService.createUser`
- `POST /api/user/loginEmail` → `UserController.loginEmail` → `UserService.loginEmail` → `AuthService.generateAccessToken` + `generateRefreshToken`. IP from `getClientIp(req)`.
- `POST /api/user/loginUsername` → same chain through `UserService.loginUsername`
- Guarded: `GET get/:id`, `GET getAll`, `DELETE :id`, `DELETE :id/hard`, `PATCH update/:user_id`. `get/:id` allows only the token owner or an admin.

## Projects (all guarded)
- `GET getAll`, `GET getAll/:user_id`, `GET :project_id`, `POST create`, `PATCH :project_id`, `DELETE :project_id`, `DELETE :project_id/hard` → `ProjectsController` → `ProjectsService`

## Tasks (all guarded) → `TaskController` → `TaskService`
- Create: `POST create`, `POST bulk-create`, `POST createSubTask`, `POST bulk-create-subtasks`
- Read: `GET getTasksByUser/:user_id`, `GET getTasksByProj/:project_id`
- Update: `PATCH :task_id`, `PATCH update-task-status/:task_id/status/:status`, `PATCH update-subtask-status/:taskSubInstance_id/status/:status` (status checked by `StatusValidationPipe`)
- Delete: `DELETE :task_id`, `DELETE :task_id/hard`, `DELETE /subTask/:subTask_id`, `DELETE deleteRecurringTasks/:taskTemplate_id`
- Analytics: `GET getDashboardData/:user_id`, `GET completion-trend/:user_id`, `GET task-distribution/:user_id`, `GET calendar-heatmap/:user_id`, `GET streak/:user_id`

## Validation and identity (DATA-02)
- Every create endpoint ignores a client `user_id`; the owner is the token `sub` (`@AuthUserId()`), and `project_id` must belong to the caller.
- `PATCH /api/user/update/:user_id` maps `fullname`, `username`, `password`, `theme`, `enableNotifications`, `soundFx` only; a changed password is hashed; a duplicate username is `409`.
- `GET /api/notifications/sse` and `DELETE /api/notifications/clear/:user_id` require a token and are scoped to it.

## Recurring tasks
- `TaskGeneratorService` `@Cron('0 0 * * *')` creates `TaskInstanceEntity` rows from `TaskTemplateEntity` every day at midnight.

## Notifications
- `TaskService` emits `task.completed` → `NotificationsService` `@OnEvent('task.completed')` creates a notification → streamed over `GET /api/notifications/sse`
- Award rules (each award is given once): `updateTaskStatus` changes the status only when it differs (`IS DISTINCT FROM`), and on a transition to Complete increments `users.lifetime_completed_count` in the same transaction (never decremented), then emits `task.completed {userId, taskId, lifetimeCount}` after commit. The listener maps each matching rule to an award key (`src/notifications/award-key.ts`) and inserts it into `user_awards` with the notification in one transaction; SSE is sent only for a newly inserted key.
  - `equals: n` on the lifetime count → `<type>:eq:<n>` (once ever); `every: n` → `<type>:every:<n>:<count>` (once per multiple); streak `equals: n` → `streak:eq:<n>:<run start date>` (once per streak run; a new run after a break can notify again)
  - `{count}` in messages is the lifetime count. The dashboard `complete_tasks` stat still counts current completed tasks
  - Migration `AwardOnce` backfills the counter from current completed tasks and the ledger from surviving notification rows by exact `(type, title)` (streak and `taskDue` rows are not backfilled). Users below their historic peak may receive some milestones once more after the migration; the ledger prevents repeats afterwards
  - Known gap (no outbox): a crash between the status commit and the listener, or a listener DB error, loses that award without retry
- `DELETE /api/notifications/clear/:user_id` clears a user's notifications. It does not touch `user_awards`.
