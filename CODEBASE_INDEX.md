# Codebase Index — Backend

One line per source file. Paths are relative to the repo root.

## Root (`src/`)
- `src/main.ts` — bootstrap, CORS, listen on `PORT`
- `src/app.module.ts` — root module: Schedule, Config, TypeORM, feature modules
- `src/app.controller.ts`, `src/app.service.ts` — health check at `GET /`
- `src/data-source.ts` — TypeORM CLI data source for migrations

## auth (`src/auth/`)
- `auth.module.ts` — JWT module setup (`JWT_SECRET`, `JWT_ACCESS_EXPIRATION`)
- `auth.controller.ts` — `POST /api/auth/refresh`, `POST /api/auth/logout`
- `auth.service.ts` — token generation, idempotent `refresh()` with grace replay, `logout()` family revoke
- `token-crypto.ts` — `sha256Hex`, `safeEqual`, AES-GCM `encryptReplay`/`decryptReplay`
- `auth-env.ts` — `validateAuthEnv()`, fail-closed startup check
- `auth-maintenance.service.ts` — hourly cleanup cron
- `auth.service.int-spec.ts` — integration tests (`pnpm test:int`)
- `../migrations/1762800000000-AuthTokenRotation.ts` — hand-written migration for the new token columns
- `../migrations/1763000000000-AwardOnce.ts` — lifetime counter, `user_awards` ledger, award backfill from notifications
- `streak.ts` — pure `computeStreak` (count and run start); `test/award-once*.int-spec.ts`, `test/jest-global-tz.ts` (TZ=UTC for jest)
- `client-ip.ts` — `getClientIp(req)` for audit records
- `guards/authorize.guard.ts` — Bearer JWT guard
- `models/auth.entity.ts` — `AuthTokenEntity`
- `models/auth.interface.ts` — auth types
- `Interfaces/authenticatedRequest.ts`, `Interfaces/tokenPayload.ts` — request and token payload types

## user (`src/user/`)
- `user.module.ts`, `user.controller.ts`, `user.service.ts` — signup, login, profile CRUD
- `models/user.entity.ts` — `UserEntity`
- `models/user.interface.ts`, `models/userCleanupResponse.ts` — user types and sanitized response
- `dto/create-user-dto.ts`, `dto/update-user-dto.ts` — request payloads

## projects (`src/projects/`)
- `projects.module.ts`, `projects.controller.ts`, `projects.service.ts` — project CRUD
- `models/projects.entity.ts` — `ProjectEntity`
- `dto/create-project-dto.ts`, `dto/update-project-dto.ts` — request payloads
- `interfaces/sanitizedProject.ts` — response shape

## task (`src/task/`)
- `task.module.ts`, `task.controller.ts`, `task.service.ts` — task and subtask CRUD, analytics
- `taskGenerator.service.ts` — daily cron for recurring instances
- `models/taskInstance.entity.ts`, `taskSubInstance.entity.ts`, `taskTemplate.entity.ts` — task entities
- `dto/create-task-dto.ts`, `create-task-subInstance-dto.ts`, `update-task-dto.ts` — request payloads
- `interfaces/` — `dashboardData`, `taskCompletionTrend`, `taskDistribution`, `calendarHeatmap`, `taskInstanceResponse`, `taskSubInstanceResponse`

## notifications (`src/notifications/`)
- `notifications.module.ts`, `notifications.controller.ts` — SSE stream and clear endpoint
- `notifications.service.ts` — `task.completed` event listener, notification creation
- `models/notifications.entity.ts`, `models/notification.interfaces.ts` — entity and types
- `award-key.ts` — pure `awardKeyFor(rule, value, ctx)`; `models/user-award.entity.ts` — award ledger
- `notification.rules.json` — notification rule definitions

## pipes (`src/pipes/`)
- `status-validation.pipe.ts` — validates task status values

## common (`src/common/`)
- `api-contract.ts` — canonical contract constants
- `is-after-or-equal.ts` — class-validator `IsAfterOrEqual`
- `api-contract.spec.ts`, `body-dtos.spec.ts` — unit specs
- `../app.setup.ts` — `configureApp()` (CORS + global ValidationPipe)
- `../auth/token-user.ts` — `toTokenUser()` allowlist; `../auth/decorators/auth-user-id.decorator.ts` — `@AuthUserId()`
- `../auth/rehash-passwords.ts`, `../migrations/1762900000000-HashPlaintextPasswords.ts`, `../../scripts/rehash-plaintext-passwords.ts`, `../../scripts/export-contract.ts`
- `../../test/` — `int-env.ts`, `int-db.ts`, `int-app.ts`, `int-auth.ts`, `authorization.int-spec.ts`, `api-contract.int-spec.ts`, `password-migration.int-spec.ts`, `fixtures/responses/`

## Root config
- `package.json`, `tsconfig.json`, `nest-cli.json`, `codegraph.json`
