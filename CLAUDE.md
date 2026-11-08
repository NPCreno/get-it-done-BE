# Get It Done — Backend API

## Stack
NestJS 11, TypeScript 5, Express platform, TypeORM 0.3, PostgreSQL

Package manager: `package.json` declares `pnpm@11.13.0`, which is a broken release (its `@pnpm/exe` ships without a binary), and the repo has `package-lock.json` but no `pnpm-lock.yaml`. Pick one and align them (the FE moved to pnpm 11.28.9).

## Deployment
Railway. The frontend is a separate Next.js app on Vercel (repo `get-it-done-FE`).

## Architecture
- 6 modules: AppModule, AuthModule, UserModule, ProjectsModule, TaskModule, NotificationsModule
- 1 guard: `AuthorizeGuard` (Bearer JWT checked with `JwtService.verifyAsync`). This is the security boundary
- 1 pipe: `StatusValidationPipe` (allows `Pending`, `Complete`, `Overdue`)
- Event-driven notifications through `@nestjs/event-emitter` (`task.completed`)
- Daily recurring-task generation through `@nestjs/schedule` (`@Cron('0 0 * * *')`)

## Modules
- `auth` — access and refresh token generation, refresh rotation and revocation
- `user` — signup, login, profile CRUD
- `projects` — project CRUD scoped to the owning user
- `task` — tasks, subtasks, recurring templates and instances, dashboard analytics
- `notifications` — SSE stream, notification creation on task completion

## Key files
- `src/auth/auth.service.ts` — `generateAccessToken`, `generateRefreshToken`, `validateRefreshToken`, `revokeRefreshToken`, `revokeUserRefreshTokens`, `refreshAccessToken`
- `src/auth/auth.controller.ts` — `POST /api/auth/refresh`
- `src/auth/guards/authorize.guard.ts` — JWT verification guard
- `src/auth/client-ip.ts` — `getClientIp(req)`, audit-only IP from request headers
- `src/user/user.controller.ts`, `user.service.ts` — login, signup, user CRUD
- `src/task/task.service.ts` — task CRUD and analytics queries
- `src/task/taskGenerator.service.ts` — daily cron that creates recurring task instances
- `src/notifications/notifications.service.ts` — `@OnEvent('task.completed')` listener
- `src/main.ts` — CORS (`FRONTEND_URL`, default `http://localhost:3000`), listens on `PORT` (default 8000)

## Entities (7)
- `UserEntity` (table `users`)
- `AuthTokenEntity` (`src/auth/models/auth.entity.ts`) — hashed refresh token records with `ip_address`
- `ProjectEntity`
- `TaskTemplateEntity` — recurring task definitions
- `TaskInstanceEntity` — individual tasks
- `TaskSubInstanceEntity` — subtasks
- `NotificationsEntity` (table `notifications`)

## Relationships
- User 1→N Project, TaskInstance, TaskSubInstance, Notification (all `onDelete: CASCADE`)
- Project 1→N TaskInstance (`CASCADE`)
- TaskTemplate 1→N TaskInstance (`SET NULL`)
- TaskInstance 1→N TaskSubInstance (`CASCADE`)

## Auth
- HS256. Access token signed with `JWT_SECRET`, lifetime from `JWT_ACCESS_EXPIRATION` (no default; the service throws if either is missing)
- Refresh token signed with `JWT_REFRESH_SECRET`, lifetime `1d`, or `7d` with `rememberMe`. Stored hashed, rotated on use
- Known issue: `auth.service.ts` falls back to the hardcoded secret `'refreshSecretKey'` when `JWT_REFRESH_SECRET` is unset. Make it fail closed like `JWT_SECRET`
- Client IP is audit data only. `getClientIp()` reads `X-Client-IP` (set by the frontend BFF), then `X-Real-IP` (set by Railway), then `req.ip`. `X-Forwarded-For` is deliberately not read and Express `trust proxy` is not enabled. Never use the IP for an auth decision

## Database
- PostgreSQL through TypeORM, `autoLoadEntities: true`, connection from `DATABASE_URL`
- `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'` (local development only)
- Migration scripts exist but `src/migrations/` has no files yet. `src/data-source.ts` serves the TypeORM CLI

## Environment
`DATABASE_URL`, `DATABASE_SYNCHRONIZE`, `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_SECRET`, `FRONTEND_URL`, `PORT`

## API endpoints (37)
- `GET /` — health check (1)
- `/api/auth` — `POST refresh` (1)
- `/api/user` — create, loginEmail, loginUsername, get/:id, getAll, delete :id, :id/hard, update/:user_id (8)
- `/api/projects` — getAll, getAll/:user_id, :project_id (get, patch, delete), create, :project_id/hard (7)
- `/api/tasks` — 18 endpoints, see `FEATURE_MAP.md`
- `/api/notifications` — `GET sse` (SSE), `DELETE clear/:user_id` (2)
- Everything except `GET /`, `refresh`, `create`, `loginEmail`, `loginUsername` and the two notification routes uses `AuthorizeGuard`

## Commands
- `pnpm start:dev` — dev server with watch
- `pnpm build` — production build
- `pnpm test` — jest (no tests written yet)
- `pnpm lint` — ESLint with auto-fix
- `pnpm migration:generate`, `pnpm migration:run`, `pnpm migration:revert` — TypeORM migrations

## CodeGraph
The repo is indexed (`.codegraph/`). Query with `codegraph_explore` and `projectPath` set to this repo.

## Maintenance
- New file: update `CODEBASE_INDEX.md`
- New endpoint or feature: update `FEATURE_MAP.md`
- Architecture change: update `docs/ARCHITECTURE.md`
