# Architecture — Backend

## Module dependency
`AppModule` imports `ScheduleModule.forRoot()`, `ConfigModule` (global), `TypeOrmModule.forRoot` (PostgreSQL, `autoLoadEntities`), `EventEmitterModule`, and the feature modules: `AuthModule`, `UserModule`, `ProjectsModule`, `TaskModule`, `NotificationsModule`, `ChatModule`, `TokensModule`, `McpModule`. `McpModule` imports the feature modules whose services the tools call (they export them); nothing imports `McpModule`.

## Request pipeline
Request → (CORS from `FRONTEND_URL`) → route → `AuthorizeGuard` on protected controllers → controller → service → TypeORM repositories → PostgreSQL.

`AuthorizeGuard` extracts the Bearer token and calls `verifyAccessToken` (`jwtService.verifyAsync`, requires `type === 'access'`; the chat WebSocket uses the same function). Its 401s carry `code: TOKEN_MISSING | TOKEN_INVALID`, which is how the frontend tells a token problem from an ownership 401. The frontend middleware is only a UX layer; this guard is the security boundary.

Two credentials, two gates. Website JWTs pass `AuthorizeGuard` on the REST routes. Personal access tokens (FEAT-07a) pass only `requireBearerAuth` + `PatVerifier`, mounted as Nest middleware on `/mcp`; since `AuthorizeGuard` verifies a JWT signature, a PAT is 401 everywhere else.

## Authentication
- Login returns an access token (`JWT_SECRET`, lifetime `JWT_ACCESS_EXPIRATION`) and a refresh token (`JWT_REFRESH_SECRET`, `1d` or `7d` with `rememberMe`).
- Refresh tokens are stored as sha256 in `AuthTokenEntity` and rotated on every refresh, inheriting `family_id` and `remember_me`. Rotation runs under `SELECT ... FOR UPDATE`; the old row keeps an AES-GCM encrypted copy of its replacement for `REFRESH_REUSE_GRACE_SECONDS`, so a repeated refresh inside the window returns the same new refresh token. A repeat after the window revokes the family (`REFRESH_REUSED`).
- Lifetimes are read from the signed tokens (`exp - iat`) and returned as `access_expires_in` / `refresh_expires_in`, so cookie lifetimes can match.
- `JWT_REFRESH_SECRET` currently falls back to a hardcoded value when unset. Fix this so the service fails closed.

## Client IP
`src/auth/client-ip.ts` returns `X-Client-IP` only when `X-Internal-Secret` matches `INTERNAL_API_SECRET` (sent by the frontend BFF) and the value passes `net.isIP()`; otherwise `null`. There is no `X-Real-IP` or `req.ip` fallback. It never blocks authentication; the value is audit data only and must never drive an auth decision. The secret is not an auth control, so endpoints stay open to other clients.

## API contract
- Canonical source: `src/common/api-contract.ts`, exported to `docs/api-contract.json` (`pnpm contract:export`), mirrored by the FE `src/app/contracts/`. Contract tests compare the JSON with the constant and the DTO metadata with the constant.
- Shapes: timestamps are ISO strings. Heatmap and trend `date` are `YYYY-MM-DD`; trend `day` is a short weekday. Analytics counts are integers. `enableNotifications` and `soundFx` are the strings `'true'` / `'false'`.
- Nullability as sent: project `title`/`description`/`color`/`colorLabel` and task `description` may be null. Task and sub-task `title` are NOT NULL. User `theme`, `enableNotifications`, `soundFx`, `role`, `status` may be null (key always present).
- Envelope endpoints return `{status, message, data}`. Raw endpoints: `getTasksByProj`, `user/get/:id`, `user/getAll`, `projects/getAll`. Empty lists are `status: 'success'` with `[]`.
- Validation: global `ValidationPipe` (whitelist, transform). Dates arrive as ISO strings and are converted by `@Type(() => Date)`. Weekly recurrence needs one or more unique weekday names.
- Authorization: create endpoints derive the owner from the token (`@AuthUserId()`); a foreign `project_id` or parent task is refused with the same message as a missing one. Admin checks read the JWT `role` claim, so a demotion applies at the next refresh (at most the access TTL).
- Known limits: access tokens minted before DATA-02 still carry the password hash until they expire; there is no access-token revocation.

## Entity relationships
```
User ─┬─< Project ─< TaskInstance
      ├─< TaskInstance ─< TaskSubInstance
      ├─< TaskSubInstance
      ├─< Notification
      ├─< ProjectMember >─ Project   (project_members, PK (project_id, user_id), both CASCADE)
      ├─< ChatMessage   >─ Project   (chat_messages, soft delete, both CASCADE)
      ├─< ChatRead      >─ Project   (chat_reads, PK (project_id, user_id), last_read_at, both CASCADE)
      └─< PersonalAccessToken        (personal_access_tokens, unique prefix, sha256 secret_hash, CASCADE)
TaskTemplate ─< TaskInstance        (onDelete: SET NULL)
AuthToken: stores user_id, sha256 token, expiry, family_id, remember_me, revoked_at, replaced_by_token_id, replay_ciphertext, ip_address (no ORM relation)
```
Deleting a user cascades to projects, tasks, subtasks and notifications. Deleting a task instance cascades to its subtasks.

## Project chat (FEAT-05)
- Sharing: the owner (`project_entity.user_id`) adds members by username into `project_members`; members see the project's name, color and chat, never its tasks. `ChatAccessService.assertCanChat` is the one access check.
- Live updates: `configureApp` installs `WsAdapter` (`@nestjs/platform-ws`), and `ChatGateway` serves `/api/chat/ws` on the HTTP port. The socket only receives: REST writes call `ChatRoomsService.broadcast` after the write, and member removal calls `kick`.
- Rooms, like the notification stream and the rate-limit counters, live in memory: correct for one API instance only. More instances need a shared pub/sub.
- Unread counts (FEAT-08a): `chat_reads` holds each user's read point per project. Unread = messages in a project the user can chat in that are not deleted, not their own, and newer than the later of `last_read_at` and (for a member) their join time `project_members.created_at`; the owner with no row counts everything. `GET /api/chat/unread` computes it in one query (a lateral `LIMIT 100` per project, so the cap also bounds the scan). `PUT .../read` upserts with `GREATEST`, so the point never moves back. Removing a member deletes their row in the same transaction. No notification rows are stored for chat.
- Live unread signal: after a chat write commits, `ChatUnreadService` emits `chat.unread.changed {userIds, projectId}` on the global `EventEmitter2` (message created or deleted: owner and members minus the actor; mark-read: the reader; member removed: that user). `NotificationsService` listens and pushes `event: chat` with data `{project_id}` onto the same per-user SSE subject as notifications, so the FE needs no extra connection. It has no notification id; Nest's `SseStream` numbers id-less frames (`ping` too), so `Last-Event-ID` is not a notification id, and nothing reads it (clients refetch on reconnect). The FE refetches `GET /api/chat/unread` on it.

## MCP server (FEAT-07a)
- `ALL /mcp`, outside `/api`. Order: `mcpJsonParser` (1 MB, in `configureApp`) → helmet/CORS (as for every route) → `mcpOriginCheck` (403) → `requireBearerAuth` from `@modelcontextprotocol/express` with `PatVerifier` (401 + `WWW-Authenticate: Bearer`) → `AuthThrottlerGuard` (`mcp` group keyed on `req.auth.clientId`, the token id) → `McpController` → `toNodeHandler(createMcpHandler(() => factory.create()))` with the parsed body.
- Stateless: a fresh `McpServer` (name `get-it-done`, package version, `instructions`) per request, no sessions, nothing in memory between requests. The SDK serves 2026-07-28 requests and 2025-era ones (initialize, tools/list, tools/call) through its stateless legacy path; a 2025 GET/DELETE is 405.
- Tools call the REST services with the token's user id; they pre-check ownership so a foreign id answers like a missing one, and run the REST DTOs' class-validator rules on mapped input. Services that answer with `{status: 'error'}` envelopes are unwrapped into a generic error (logged, never shown).
- Phase 2 (FEAT-07c/d) adds OAuth and `/.well-known/oauth-protected-resource`; the verifier interface stays.

## Events and schedules
- `task.completed` is emitted by `TaskStatusService` and consumed by `NotificationsService`.
- `chat.unread.changed` is emitted by `ChatUnreadService` and consumed by `NotificationsService` (FEAT-08a); the modules don't import each other.
- `TaskGeneratorService` runs daily at midnight and creates instances from templates.

## Database
PostgreSQL through TypeORM (production: Neon). `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'` (local development and tests). Production's schema came from synchronize before any migration ran; `src/migrations/1762700000000-CatchUpBaseline.ts` (OPS-04) creates what that baseline lacks (`notifications`), and the hand-written migrations after it run in one transaction on every Render start (`npm run start:render`). Task `id` is uuid, as in production.
