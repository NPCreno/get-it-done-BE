# Codebase Index — Backend

One line per source file. Paths are relative to the repo root.

## Root (`src/`)
- `src/main.ts` — bootstrap, CORS, listen on `PORT`
- `src/app.module.ts` — root module: Schedule, Config, TypeORM, feature modules
- `src/app.controller.ts`, `src/app.service.ts` — health check at `GET /`
- `src/config/env.validation.ts` — boot-time environment validation (replaces `auth/auth-env.ts`); `test/boot-validation.int-spec.ts` spawns `main.ts`
- `src/data-source.ts` — TypeORM CLI data source for migrations

## auth (`src/auth/`)
- `auth.module.ts` — JWT module setup (`JWT_SECRET`, `JWT_ACCESS_EXPIRATION`)
- `auth.controller.ts` — `POST /api/auth/refresh`, `POST /api/auth/logout`
- `auth.service.ts` — token generation, idempotent `refresh()` with grace replay, `logout()` family revoke
- `token-crypto.ts` — `sha256Hex`, `safeEqual`, AES-GCM `encryptReplay`/`decryptReplay`
- `auth-maintenance.service.ts` — hourly cleanup cron
- `auth.service.int-spec.ts` — integration tests (`pnpm test:int`)
- `../migrations/1762700000000-CatchUpBaseline.ts` — OPS-04: creates `notifications` (synchronize's DDL) where production lacks it; no-op elsewhere. `test/catchup-migration.int-spec.ts`; drift record `docs/migrations/2026-11-17-prod-drift.md`
- `../migrations/1762800000000-AuthTokenRotation.ts` — hand-written migration for the new token columns
- `../migrations/1763000000000-AwardOnce.ts` — lifetime counter, `user_awards` ledger, award backfill from notifications
- `../migrations/1763400000000-TemplateAndTokenForeignKeys.ts` — REF-14c: `FK_task_template_user`, `FK_task_template_project`, `FK_auth_token_user` (all CASCADE); `test/template-token-fks.int-spec.ts`
- `streak.ts` — pure `computeStreak` (count and run start); `test/award-once*.int-spec.ts`, `test/jest-global-tz.ts` (TZ=UTC for jest)
- `client-ip.ts` — `getClientIp(req)` for audit records
- `rate-limit/` — `ip.ts`, `client-key.ts`, `identifier-key.ts`, `rate-limits.ts` (throttler table), `rate-limit.decorator.ts`, `auth-throttler.guard.ts`, `rate-limit-config.module.ts` (SEC-09)
- `../user/identifier.ts` — shared email-like test and `normalizeEmail` (trim + lower-case, BUG-01) used by signup, login lookup and rate limiting
- `guards/authorize.guard.ts` — Bearer JWT guard
- `verify-access-token.ts` — `verifyAccessToken()`, the access-token check shared by `AuthorizeGuard` and the chat gateway
- `models/auth.entity.ts` — `AuthTokenEntity`
- `models/auth.interface.ts` — auth types
- `Interfaces/authenticatedRequest.ts`, `Interfaces/tokenPayload.ts` — request and token payload types

## user (`src/user/`)
- `user.module.ts`, `user.controller.ts`, `user.service.ts` — signup, login, profile CRUD; `user-signup.spec.ts` — BUG-07 duplicate signup 409, no database text or email in answers and logs
- `models/user.entity.ts` — `UserEntity`
- `models/user.interface.ts`, `models/userCleanupResponse.ts` — user types and sanitized response
- `dto/create-user-dto.ts`, `dto/update-user-dto.ts` — request payloads

## projects (`src/projects/`)
- `projects.module.ts`, `projects.controller.ts`, `projects.service.ts` — project CRUD
- `models/projects.entity.ts` — `ProjectEntity`
- `dto/create-project-dto.ts`, `dto/update-project-dto.ts` — request payloads
- `interfaces/sanitizedProject.ts` — response shape

## task (`src/task/`)
- `task.module.ts`, `task.controller.ts` — wiring and routes; services: `task.service.ts` (task writes), `task-query.service.ts`, `subtask.service.ts`, `task-status.service.ts`, `task-stats.service.ts`, `task-streak.service.ts`, `task-recurrence.service.ts`; `task-ids.ts`, `service-size.spec.ts`
- `taskGenerator.service.ts` — daily cron for recurring instances
- FEAT-09a shared tasks: `task-access.service.ts` — `TaskAccessService` (`assertCanUseTask`, `assertCanUseProject` via `ChatAccessService`, `assertAssignable`, `assertCanDelete`), pure `decideTaskAccess`, `rethrowAccess` and the fixed messages; `task-scope.ts` — the shared SQL `responsibleSql`/`responsibleIs`/`accessibleTo`/`myTasks`; `task-assign.service.ts` — `TaskAssignService` (`setAssignee`, `notifyAssignment`, after-commit `tasksChanged` / `notificationCreated`); `task-events.ts` — `TASKS_CHANGED`, `NOTIFICATION_CREATED`, pure `tasksEventRecipients`, `assignmentMessage`; `dto/set-assignee-dto.ts`; `task-access.spec.ts`; `../migrations/1763600000000-SharedTasks.ts`; `../../test/shared-tasks.int-spec.ts`, `shared-tasks-migration.int-spec.ts`
- `models/taskInstance.entity.ts`, `taskSubInstance.entity.ts`, `taskTemplate.entity.ts` — task entities
- `dto/create-task-dto.ts`, `create-task-subInstance-dto.ts`, `update-task-dto.ts` — request payloads
- `interfaces/` — `dashboardData`, `taskCompletionTrend`, `taskDistribution`, `calendarHeatmap`, `taskInstanceResponse`, `taskSubInstanceResponse`

## notifications (`src/notifications/`)
- `notifications.module.ts`, `notifications.controller.ts` — SSE stream and clear endpoint
- `notifications.service.ts` — `task.completed` event listener, notification creation
- `models/notifications.entity.ts`, `models/notification.interfaces.ts` — entity and types
- `award-key.ts` — pure `awardKeyFor(rule, value, ctx)`; `models/user-award.entity.ts` — award ledger
- `notification.rules.json` — notification rule definitions

## chat (`src/chat/`) — FEAT-05 project sharing and chat
- `chat.module.ts`, `chat.controller.ts` — `/api/chat` routes (members, shared-projects, messages)
- `chat-access.service.ts` — `assertCanChat` / `assertOwner` (owner or member; a stranger gets the missing-project 404), pure `decideAccess`
- `chat-members.service.ts` — list, add by username (locked, 20 max), remove/leave, shared-projects
- `chat-messages.service.ts` — paged list, send, soft delete; broadcasts after the write
- `chat-rooms.service.ts` — in-memory rooms, `broadcast`, `kick` (one API instance)
- `chat.gateway.ts` — receive-only WebSocket at `/api/chat/ws` (origin check, auth frame, join/leave, 4401); `ws-origin.ts` — `isAllowedOrigin`
- `chat-cursor.ts` — opaque `(created_at, id)` page cursor; `chat.dto.ts` — response shapes and `toMessageDto`
- `chat-unread.service.ts` — FEAT-08a unread counts (one query), mark-read upsert, recipients and `notify`; `chat-events.ts` — `CHAT_UNREAD_CHANGED`, pure `unreadRecipients`
- `dto/add-member.dto.ts`, `dto/send-message.dto.ts`, `dto/list-messages-query.dto.ts`, `dto/mark-read.dto.ts` — request payloads
- `models/project-member.entity.ts`, `models/chat-message.entity.ts`, `models/chat-read.entity.ts` — `ProjectMemberEntity`, `ChatMessageEntity`, `ChatReadEntity`
- `../migrations/1763100000000-ProjectChat.ts` — `project_members`, `chat_messages`; `1763200000000-ChatReads.ts` — `chat_reads` (FEAT-08a)
- `*.spec.ts` — access, cursor, DTO validation, rooms and origin unit specs; `../../test/chat.int-spec.ts`, `chat-ws.int-spec.ts`, `project-chat-migration.int-spec.ts`, `chat-unread.int-spec.ts`, `chat-reads-migration.int-spec.ts`, `chat-fixtures.ts`

## tokens (`src/tokens/`) — FEAT-07a personal access tokens
- `tokens.module.ts`, `tokens.controller.ts` — `/api/tokens` (list, create, revoke; website JWT; `no-store`)
- `tokens.service.ts` — list, create (10 active, users row lock), revoke, `verify` (prefix lookup, constant-time hash check, active user), `touch` (`last_used_at` once a minute), `tokenStatus`, `toTokenDto`
- `pat-format.ts` — `generatePat`, `parsePat`, `hashSecret`, `secretMatches` (`gid_pat_<10 base62>_<43 base64url>`)
- `dto/create-token.dto.ts`; `models/personal-access-token.entity.ts`; `../migrations/1763300000000-PersonalAccessTokens.ts`
- `pat-format.spec.ts`; `../../test/tokens.int-spec.ts`, `pat-migration.int-spec.ts`

## mcp (`src/mcp/`) — FEAT-07a MCP server
- `mcp.module.ts` — middleware (`mcpOriginCheck`, `requireBearerAuth`) on `/mcp`; `mcp.controller.ts` — `@All('mcp')`, `@RateLimit('mcp')`, `toNodeHandler(createMcpHandler(...))`
- `mcp-server.factory.ts` — `McpServerFactory` (one `McpServer` per request), `ALL_TOOLS`, `MCP_INSTRUCTIONS`
- `pat-verifier.ts` — `PatVerifier` (`OAuthTokenVerifier`); `mcp-token-verifier.ts` — FEAT-07c `McpTokenVerifier` (the `/mcp` verifier: `gid_pat_` → `PatVerifier`, `gid_oat_` → `OAuthGrantsService`)
- `mcp-tool.ts` — `defineTool`, `McpDeps`, result/error helpers, call logging; `mcp-shapes.ts` — zod output schemas and safe mappers; `mcp-validate.ts` — `toDto` (REST DTO rules); `mcp-errors.ts` — `toolErrorMessage`, `unwrap`; `mcp-origin.ts` — `parseAllowedOrigins`, `originAllowed`, `mcpOriginCheck`
- `tools/account-tools.ts`, `tools/task-tools.ts`, `tools/project-tools.ts`, `tools/chat-tools.ts` — the 21 tools
- `pat-verifier.spec.ts`, `mcp-units.spec.ts`; `../../test/mcp.int-spec.ts`, `mcp-helpers.ts`; user docs `../../docs/MCP.md`

## oauth (`src/oauth/`) — FEAT-07c OAuth for MCP connectors
- `oauth.module.ts` — controllers, services, entities, `noStore` middleware
- `oauth-metadata.controller.ts` — `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`
- `oauth-public.controller.ts` — `POST /oauth/register`, `/oauth/token`, `/oauth/revoke` (`OAuthExceptionFilter`)
- `oauth-api.controller.ts` — `/api/oauth/authorize/check`, `/api/oauth/authorize`, `/api/oauth/grants` (website JWT)
- `oauth-config.ts` — `oauthUrls()` (issuer from `RENDER_EXTERNAL_URL`/`PUBLIC_API_URL`), metadata builders
- `oauth-params.ts` — pure rules: `redirectUriProblem`, `redirectMatches` (loopback port rule), `validateRegistration`, `parseScope`, `validateAuthorize` (fatal vs redirectable), `withParams`
- `oauth-format.ts` — `gid_oat_`/`gid_ort_` tokens, `gid_cli_` client ids, codes, PKCE `pkceS256`/`pkceMatches`
- `oauth-errors.ts` — `OAuthHttpError`, `authorizeHttpError`, `OAuthExceptionFilter`
- `oauth-clients.service.ts` (DCR, `find`), `oauth-authorize.service.ts` (check, decision), `oauth-token.service.ts` (code exchange, refresh rotation and retry grace, revoke), `oauth-grants.service.ts` (list, revoke, `revokeGrant`, `verifyAccess`, `touch`), `oauth-maintenance.service.ts` (daily cleanup)
- `dto/authorize.dto.ts`; `models/oauth-{client,grant,code,token}.entity.ts`; `../migrations/1763500000000-OAuth.ts`
- `oauth-units.spec.ts`; `../../test/oauth.int-spec.ts`, `oauth-migration.int-spec.ts`

## pipes (`src/pipes/`)
- `status-validation.pipe.ts` — validates task status values

## common (`src/common/`)
- `api-contract.ts` — canonical contract constants
- `is-after-or-equal.ts` — class-validator `IsAfterOrEqual`
- `ids.ts` — REF-14b `newId(prefix)`: `<prefix>-<uuid v4>` for every business id (user, PRJ, task, generatedTask, TMP, subTask, notif); `ids.spec.ts`
- `api-contract.spec.ts`, `body-dtos.spec.ts` — unit specs
- `../app.setup.ts` — `configureApp()` (helmet, CORS, global ValidationPipe, `WsAdapter`)
- `../auth/token-user.ts` — `toTokenUser()` allowlist; `../auth/decorators/auth-user-id.decorator.ts` — `@AuthUserId()`; `../auth/decorators/current-user.decorator.ts` — `@CurrentUser()`; `../auth/guards/self-param.guard.ts` — `SelfParam()` (the one id comparison); `../auth/guards/admin-only.guard.ts`; `../common/controller-identity.spec.ts` — scans controllers
- `../auth/rehash-passwords.ts`, `../migrations/1762900000000-HashPlaintextPasswords.ts`, `../../scripts/rehash-plaintext-passwords.ts`, `../../scripts/export-contract.ts`
- `../../test/` — `int-env.ts`, `int-db.ts`, `int-app.ts`, `int-auth.ts`, `authorization.int-spec.ts`, `api-contract.int-spec.ts`, `password-migration.int-spec.ts`, `catchup-migration.int-spec.ts`, `login-email-case.int-spec.ts` (BUG-01), `signup.int-spec.ts` (BUG-07 duplicate signup 409), `uuid-ids.int-spec.ts` (REF-14b), `fixtures/responses/`

## Root config
- `package.json`, `tsconfig.json`, `nest-cli.json`, `codegraph.json`
