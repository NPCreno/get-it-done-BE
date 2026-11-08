# Feature Map — Backend

Endpoint → implementing chain. All routes are under `/api`. "Guarded" means `AuthorizeGuard`.

## Auth
- `POST /api/auth/refresh` → `AuthController.refreshToken` → `AuthService.refreshAccessToken` → `validateRefreshToken`, `revokeRefreshToken`, `generateAccessToken`, `generateRefreshToken`. IP comes from `getClientIp(req)`; a client-sent `ipAddress` body field is ignored.

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
- Update: `PATCH :task_id`, `PATCH update-task-status/:task_id/status/:status`, `PATCH update-subTask-status/:taskSubInstance_id/status/:status` (status checked by `StatusValidationPipe`)
- Delete: `DELETE :task_id`, `DELETE :task_id/hard`, `DELETE /subTask/:subTask_id`, `DELETE deleteRecurringTasks/:taskTemplate_id`
- Analytics: `GET getDashboardData/:user_id`, `GET completion-trend/:user_id`, `GET task-distribution/:user_id`, `GET calendar-heatmap/:user_id`, `GET streak/:user_id`

## Recurring tasks
- `TaskGeneratorService` `@Cron('0 0 * * *')` creates `TaskInstanceEntity` rows from `TaskTemplateEntity` every day at midnight.

## Notifications
- `TaskService` emits `task.completed` → `NotificationsService` `@OnEvent('task.completed')` creates a notification → streamed over `GET /api/notifications/sse`
- `DELETE /api/notifications/clear/:user_id` clears a user's notifications. Neither notification route is guarded.
