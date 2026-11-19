# Get It Done — Backend API

## Stack
NestJS 11, TypeScript 5, Express platform, TypeORM 0.3, PostgreSQL

Package manager: npm (`packageManager: npm@10.9.2`, `package-lock.json`), which is also what the Dockerfile and Render use. A migration to pnpm 11.28.9 like the FE is a separate follow-up (REF-03; on Render it also needs the build command changed); the old `pnpm@11.13.0` pin was a broken release.

## Deployment
Render, a free Node web service (not Docker), auto-deploys `master`. Build: `npm install, npm run build`. Start: `npm run start:render`, which runs pending migrations (`dist/data-source.js`) and then `node dist/main`. The free instance has no Pre-Deploy Command and no shell, so migrations run on every start: one instance (no concurrent runs), applied migrations are skipped, and a failure rolls back the whole batch and fails the deploy (the previous build keeps serving). `NODE_ENV=production` is set in the Render environment. Database: Neon Postgres (use a Neon branch as the production copy for checks; never point tools at production). The frontend is a separate Next.js app on Vercel (repo `get-it-done-FE`).
- Production schema came from synchronize before any migration ran. `1762700000000-CatchUpBaseline` creates the missing `notifications` table (synchronize's exact DDL, a no-op where it exists) so the later migrations can run. `docs/migrations/2026-11-17-prod-drift.md` records the drift
- `task_instance_entity.id` is `uuid` (as production has it). Nothing joins on it; everything uses `task_id`. A local database built before OPS-04 has an integer `id`: synchronize recreates it as uuid on the next start, or drop it and restore a fresh dump (`npm run db:restore`)

## Architecture
- 9 modules: AppModule, AuthModule, UserModule, ProjectsModule, TaskModule, NotificationsModule, ChatModule, TokensModule, McpModule
- 1 guard: `AuthorizeGuard` (Bearer JWT checked with `JwtService.verifyAsync`). This is the security boundary
- 1 pipe: `StatusValidationPipe` (allows `Pending`, `Complete`, `Overdue`)
- Event-driven notifications through `@nestjs/event-emitter` (`task.completed`)
- Daily recurring-task generation through `@nestjs/schedule` (`@Cron('0 0 * * *')`)
- One WebSocket gateway (`ChatGateway`, `@nestjs/platform-ws` `WsAdapter` set in `configureApp`) at `/api/chat/ws`, receive only
- One MCP endpoint (FEAT-07a, `McpModule`) at `/mcp` (no `/api`), MCP TypeScript SDK v2, personal access tokens only (see MCP below)

## Modules
- `auth` — access and refresh token generation, refresh rotation and revocation
- `user` — signup, login, profile CRUD
- `projects` — project CRUD scoped to the owning user
- `task` — tasks, subtasks, recurring templates and instances, dashboard analytics
- `notifications` — SSE stream, notification creation on task completion
- `tokens` — FEAT-07a personal access tokens (`/api/tokens`, website JWT): list, create, revoke; `verify`/`touch` for the MCP verifier
- `mcp` — FEAT-07a MCP server: 21 tools over the same services as the REST routes
- `chat` — FEAT-05: project sharing by username (`project_members`), project chat messages (`chat_messages`), WebSocket rooms; FEAT-08a unread counts (`chat_reads`) with a `chat` event on the notifications SSE stream

## Key files
- `src/auth/auth.service.ts` — `generateAccessToken`, `generateRefreshToken`, `validateRefreshToken`, `revokeRefreshToken`, `revokeUserRefreshTokens`, `refreshAccessToken`
- `src/auth/auth.controller.ts` — `POST /api/auth/refresh`
- `src/auth/guards/authorize.guard.ts` — JWT verification guard; `src/auth/verify-access-token.ts` — `verifyAccessToken()`, shared with the chat gateway
- `src/config/env.validation.ts` — boot-time env validation (`validateEnv`, `validateDatabaseEnv`, `checkDatabaseUrl`)
- `src/auth/client-ip.ts` — `getClientIp(req)`, audit-only IP from request headers; `hasValidInternalSecret(req)`
- `src/auth/rate-limit/` — SEC-09: `@RateLimit(group)` + one `AuthThrottlerGuard`, named throttlers in `rate-limits.ts`, `clientKey()`, `identifierKey()`, `normalizeIp()`
- `src/user/user.controller.ts`, `user.service.ts` — login, signup, user CRUD
- `src/task/task.service.ts` — task create/update/delete (`TaskService`); `task-query.service.ts` list reads; `subtask.service.ts` subtask writes; `task-status.service.ts` status transitions (award-once transaction, `task.completed` emit); `task-stats.service.ts` dashboard, trend, distribution, heatmap (SQL counts); `task-streak.service.ts` streak; `task-recurrence.service.ts` recurring deletes; `task-ids.ts` id generators. Each under about 400 lines (`service-size.spec.ts`)
- `src/task/taskGenerator.service.ts` — daily cron that creates recurring task instances; also runs once at boot (`onModuleInit`)
- `src/notifications/notifications.service.ts` — `@OnEvent('task.completed')` listener
- `src/chat/chat-access.service.ts` — `assertCanChat` (owner or member, project not deleted; a stranger gets the missing-project 404); `chat-members.service.ts`, `chat-messages.service.ts`, `chat-rooms.service.ts` (in-memory rooms), `chat.gateway.ts`; `chat-unread.service.ts` (unread counts, mark-read, `chat.unread.changed` emit)
- `src/main.ts` — CORS (`FRONTEND_URL`, default `http://localhost:3000`), listens on `PORT` (default 8000)

## Entities (12)
- `UserEntity` (table `users`)
- `AuthTokenEntity` (`src/auth/models/auth.entity.ts`) — refresh token records: sha256 hash, `family_id`, `remember_me`, `revoked_at`, `replaced_by_token_id`, `replay_ciphertext`, nullable `ip_address`
- `ProjectEntity`
- `TaskTemplateEntity` — recurring task definitions
- `TaskInstanceEntity` — individual tasks
- `TaskSubInstanceEntity` — subtasks
- `NotificationsEntity` (table `notifications`)
- `UserAwardEntity` (`src/notifications/models/user-award.entity.ts`, table `user_awards`) — award ledger
- `ProjectMemberEntity` (`src/chat/models/project-member.entity.ts`, table `project_members`, PK `(project_id, user_id)`) — users a project is shared with; the owner is never a row
- `ChatMessageEntity` (`src/chat/models/chat-message.entity.ts`, table `chat_messages`) — uuid id from the app, `body` varchar(2000), `created_at`/`deleted_at` timestamptz(3), soft delete
- `PersonalAccessTokenEntity` (`src/tokens/models/personal-access-token.entity.ts`, table `personal_access_tokens`) — FEAT-07a: uuid id from the app, `user_id` (CASCADE), `name` varchar(60), `prefix` varchar(16) UNIQUE (10 base62 chars, public), `secret_hash` char(64) (sha256 of the secret part), `scopes` (`mcp`), `created_at`, `last_used_at`, `expires_at`, `revoked_at`
- `ChatReadEntity` (`src/chat/models/chat-read.entity.ts`, table `chat_reads`, PK `(project_id, user_id)`) — FEAT-08a read point `last_read_at` timestamptz(3); only moves forward (`GREATEST`); deleted with the membership

## Relationships
- User 1→N Project, TaskInstance, TaskSubInstance, Notification, UserAward (all `onDelete: CASCADE`)
- Project 1→N TaskInstance (`CASCADE`)
- TaskTemplate 1→N TaskInstance (`SET NULL`)
- TaskInstance 1→N TaskSubInstance (`CASCADE`)
- Project 1→N ProjectMember, ChatMessage, ChatRead; User 1→N ProjectMember, ChatMessage, ChatRead (all `CASCADE`)
- User 1→N PersonalAccessToken (`CASCADE`)

## Auth
- HS256. Access token signed with `JWT_SECRET`, lifetime from `JWT_ACCESS_EXPIRATION` (no default; the service throws if either is missing)
- Refresh token signed with `JWT_REFRESH_SECRET`. Lifetime `JWT_REFRESH_EXPIRATION` (default `7d`, Remember Me) or `JWT_REFRESH_EXPIRATION_SHORT` (default `1d`); `remember_me` is stored on the row and inherited on rotation. Stored as sha256 (legacy rows: bcrypt, starts with `$2`)
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRATION` are required at startup (see Environment); no fallbacks
- `POST /api/auth/refresh` is idempotent: `SELECT ... FOR UPDATE` on the token row. Active row: rotate (same `family_id`) and store an AES-GCM replay of the new token. Revoked within `REFRESH_REUSE_GRACE_SECONDS` (30): the same refresh token is replayed with a fresh access token. Revoked beyond grace with a replacement: family revoked, `401 REFRESH_REUSED`. Otherwise `401 REFRESH_INVALID`. Responses carry `access_expires_in` / `refresh_expires_in`; `expires_in: 3600` is legacy
- `POST /api/auth/logout {refreshToken}` revokes the family, always 204
- `AuthorizeGuard` 401s carry `code: TOKEN_MISSING | TOKEN_INVALID`, and a token with `type !== 'access'` is rejected. Other 401s (ownership checks) have no code
- `AuthMaintenanceService` (hourly cron) nulls expired replay ciphertext and deletes rows expired more than a day
- Client IP is audit data only. `getClientIp()` returns `X-Client-IP` only when `X-Internal-Secret` matches `INTERNAL_API_SECRET` and the value is a valid IP; otherwise `null`. No `X-Real-IP`/`req.ip` fallback. Never use the IP for an auth decision
- Rate limiting (SEC-09, `src/auth/rate-limit/`): only login (`loginEmail`/`loginUsername`, shared buckets), `refresh`, `logout`, signup (`user/create`), chat message send (`chatMessage`, 30/min per token user) and chat member add (`chatMember`, 60/h per token user) carry `@RateLimit(group)`; there is no global guard. Chat groups key on the token `sub`, so `AuthorizeGuard` must run first (class-level `@UseGuards`). Client key order: `attested` (valid secret + IP, IPv6 as /64) > `bff-noip` (shared bucket) > `unattested` (single valid `X-Real-IP`, else socket; `X-Forwarded-For` and an unattested `X-Client-IP` are never read; Render documents no `X-Real-IP`, so on Render unattested callers usually share the proxy's socket bucket and the global cap bounds them). Unattested traffic also hits a global cap per group. Login adds a per-identifier limit keyed on the lookup value: an email trimmed and lower-cased (`normalizeEmail`, BUG-01), a username exact (no case folding). No `trust proxy`. Counters are in memory, so this assumes ONE API instance (same as the notification stream). A 429 has `Retry-After` in seconds and the fixed message; logs carry the throttler name only, never IP, identifier or key. Tests override the limits via the `RATE_LIMITS` token (`createTestApp()` uses high limits, `createTestApp({})` the real ones). Signup must go through the FE BFF (`/api/auth/signup`) so it is attested
- Personal access tokens (FEAT-07a): `gid_pat_<prefix>_<secret>`, shown once at creation, stored as sha256 of the secret (compared with `timingSafeEqual`). Valid ONLY on `/mcp`: `AuthorizeGuard` accepts only JWTs, so a PAT on any REST route is 401. Expiry 30/90 (default)/365 days or none; 10 active per user (users row lock); revoke is idempotent; `last_used_at` at most once a minute. Never log a token or hash; the prefix is fine. `/api/tokens` responses carry `Cache-Control: no-store`; create is `@RateLimit('tokenCreate')` (10/h per user)
- Helmet is set in `configureApp` (CSP `default-src 'none'`, HSTS 180 days without `includeSubDomains` until the API hostname is confirmed)
- Compose: Postgres 17 on volume `pgdata17`, bound to 127.0.0.1, `POSTGRES_PASSWORD` required. `DATABASE_SYNCHRONIZE` stays true in `.env.example` until REF-14 adds a baseline migration

## Database
- PostgreSQL through TypeORM, `autoLoadEntities: true`, connection from `DATABASE_URL`
- `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'` (local development only)
- Migrations are hand-written (`src/migrations/`); prod's schema is not what `migration:generate` assumes, so do not use it. They run on every Render start through `npm run start:render` (compiled, `node node_modules/typeorm/cli.js migration:run -d dist/data-source.js`); `npm run migration:run` (ts-node) is for development. `src/data-source.ts` serves the TypeORM CLI. All pending migrations share one transaction

## Local database
Postgres 17 runs in Docker (`docker-compose.dev.yml`, database only; the app runs natively with `pnpm start:dev`). It listens on `127.0.0.1:5433` because 5432 is often taken by a native Postgres. Defaults: user `postgres`, password `dev`, database `getitdone` (override with `POSTGRES_*` in `.env`).
- `pnpm db:up` / `pnpm db:down` — start / stop the container
- `pnpm db:logs`, `pnpm db:psql` — logs, psql shell
- `pnpm db:dump` — back up the local DB to `db_dumps/local_<timestamp>.dump`
- `pnpm db:restore [file]` — replace the local DB with a dump (newest in `db_dumps/` by default)
- `pnpm db:pull [label]` — read-only `pg_dump` of the database in `SOURCE_DATABASE_URL` (set in gitignored `scripts/.env.dump`), for example Neon
- The scripts are bash: run them from Git Bash or WSL. Dumps hold real data and are gitignored; delete them when done. Never point `DATABASE_SYNCHRONIZE=true` at a shared database

## API contract and validation
- `src/common/api-contract.ts` is the canonical contract (enums, limits, patterns). DTO decorators import it. `pnpm contract:export` writes `docs/api-contract.json`, which the FE vendors (`contract:sync` in the FE repo). Changed the contract: export, then sync
- `API_CONTRACT.routes` holds paths the FE calls; `routes.spec.ts` ties them to the controller; changing one means export, then sync.
- A global `ValidationPipe` is set up in `src/app.setup.ts` (`configureApp`, used by `main.ts` and tests): `whitelist: true`, `transform: true`, no implicit conversion. Undecorated DTO properties are stripped silently
- Rule: every `@Body()` is a fully decorated class, or a documented inline type with manual validation (`auth` refresh/logout). `src/common/body-dtos.spec.ts` fails if a body class has an undecorated property
- Services map DTO fields explicitly. Never spread a body into `create()`/`update()`
- Identity is server-derived: create endpoints take no `user_id`; use `@AuthUserId()` (the token `sub`). Whitelisting is not authorization: every mutation loads the resource and compares its owner with the token
- Controllers never read `req.user` or compare ids. Use `@AuthUserId()`, `@CurrentUser()` (token claim, for roles), `SelfParam('param', { allowAdmin? })` and `AdminOnlyGuard`, listed after `AuthorizeGuard`. A mismatch is 401 `Access denied: Not your data.` / `Admin only.`. Enforced by `src/common/controller-identity.spec.ts`
- Counts are SQL aggregates (`count`/`FILTER`/`GROUP BY`); never load entities to count them. `test/sql-counts.int-spec.ts` pins query counts and semantics
- `toTokenUser()` (`src/auth/token-user.ts`) is the only way to build a JWT user. Never spread the entity (it carries the password hash)
- Notifications: `GET sse` and `DELETE clear/:user_id` are guarded and scoped to the token user
- Awards are given once: `users.lifetime_completed_count` only goes up (+1 on a real transition to Complete, in the same transaction as the status change; never decremented), and each matched rule is recorded in `user_awards` (`awardKeyFor`, PK `(user_id, award_key)`) in the same transaction as its notification. Clearing notifications never touches the ledger. Streak awards are once per streak run. Known gap: no outbox, so a crash between commit and the `task.completed` listener loses that completion's awards
- Password changes are bcrypt-hashed (cost 12). Migration `HashPlaintextPasswords` fixes old plaintext rows; `npm run db:rehash-passwords` is the idempotent straggler script. bcrypt 6 ships prebuilt Node-API binaries (glibc and musl, no `tar`, no node-pre-gyp, no compiler in the image); `src/auth/bcrypt-compat.spec.ts` pins hashes made by 5.1.1
- Tests: `pnpm test` (contract and body-DTO unit specs), `pnpm test:int` (authorization, contract, migration, auth). `WRITE_FIXTURES=1 pnpm test:int` rewrites `test/fixtures/responses/`

## MCP (FEAT-07a, `src/mcp/`)
- SDK v2: `@modelcontextprotocol/server` 2.4.0 (`createMcpHandler`, `McpServer`), `@modelcontextprotocol/node` 2.1.2 (`toNodeHandler`), `@modelcontextprotocol/express` 2.0.2 (`requireBearerAuth`, Express middleware), zod 4 (`zod/v4`, used only in `src/mcp/`); the test client is `@modelcontextprotocol/client` 2.4.0. Exact versions pinned
- Pipeline for `ALL /mcp`: `app.use('/mcp', mcpJsonParser)` (1 MB; the wrapper must not be named `jsonParser` or Nest skips its own parser for every route) → `mcpOriginCheck` (403 when an `Origin` header is not in `MCP_ALLOWED_ORIGINS`; empty by default) → `requireBearerAuth({ verifier: PatVerifier, requiredScopes: ['mcp'] })` (401 + `WWW-Authenticate: Bearer`, no `resource_metadata` until OAuth in phase 2) → `@RateLimit('mcp')` (120/min per token id, 429 + `Retry-After`) → `McpController` → `toNodeHandler(createMcpHandler(factory))`
- Stateless: one `McpServer` per request (`McpServerFactory.create`). Serves 2026-07-28 and 2025-era clients (default `legacy: 'stateless'`); a 2025 GET/DELETE is 405
- `PatVerifier.verifyAccessToken` → `AuthInfo { clientId: token id, scopes: ['mcp'], expiresAt (token expiry, or now + 1 h for no expiry: the SDK rejects an unset one), extra: { userId, prefix } }`
- Tools (`src/mcp/tools/*.ts`, `defineTool` in `mcp-tool.ts`): strict zod input with `.describe()` on every field (a unit spec enforces it), never a user id; `userId` comes from `ctx.http.authInfo.extra`. Output is a text summary + compact JSON + `structuredContent` with an `outputSchema`; safe shapes only (`mcp-shapes.ts`). Writes run the REST DTOs' class-validator rules (`toDto`) and call the same services. Ownership is checked first, so a foreign and a missing item give the same 404 label. Errors (`mcp-errors.ts`): safe 404 label, 401/403 "Not allowed", 400 message passed through, anything else "Something went wrong" (logged in full). One log line per call: tool, token prefix, user, ms, ok/error; never arguments or results
- Nullable output fields render as `type: ["string","null"]` (zod 4 always collapses them); the Inspector's 56 "schema portability" warnings are exactly these, all in output schemas. Input schemas have none. Claude Code connects fine
- Deletes are soft and `destructiveHint: true`; hard-delete and admin routes are never exposed. User docs: `docs/MCP.md`

## Environment
Validated at boot by `src/config/env.validation.ts` (`validateEnv`, called in `main.ts` before `AppModule` is loaded; any error prints the variable names and rules, never values, and exits 1). The migration CLI (`data-source.ts`) checks `DATABASE_URL` with the same `checkDatabaseUrl`. Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRATION`. Expiries need a unit (`15m`, `3600s`; a bare number is milliseconds to jsonwebtoken). Strict: `DATABASE_SYNCHRONIZE` is exactly `true`/`false`; `PORT` 1-65535; `REFRESH_REUSE_GRACE_SECONDS` 0-3600. `NODE_ENV` is `development|test|production` (default `development` locally, but required when `RENDER` (set by Render on every service), `RAILWAY_ENVIRONMENT_NAME` or `RAILWAY_PROJECT_ID` is present). Production-only: `FRONTEND_URL` required, an origin only and not local (`FRONTEND_URL_ALLOW_LOCAL=true` opts out for a smoke test), and `DATABASE_SYNCHRONIZE=true` is an error; secrets under 32 characters or equal only warn. `AppEnv` is a diagnostic view; readers keep their own reads and defaults. A good boot logs `[Env] configuration valid (NODE_ENV=...)`.
Optional `MCP_ALLOWED_ORIGINS` (FEAT-07a): comma-separated origins allowed to call `/mcp` from a browser; each must be an origin only, else boot fails.
`NODE_ENV`, `FRONTEND_URL_ALLOW_LOCAL`, `MCP_ALLOWED_ORIGINS`, `DATABASE_URL`, `DATABASE_SYNCHRONIZE`, `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION`, `JWT_REFRESH_EXPIRATION_SHORT`, `REFRESH_REUSE_GRACE_SECONDS`, `INTERNAL_API_SECRET`, `FRONTEND_URL`, `PORT`

## API endpoints (50)
- `GET /` — health check (1)
- `/api/auth` — `POST refresh`, `POST logout` (2)
- `/api/user` — create, loginEmail, loginUsername, get/:id, getAll, delete :id, :id/hard, update/:user_id (8)
- `/api/projects` — getAll, getAll/:user_id, :project_id (get, patch, delete), create, :project_id/hard (7)
- `/api/tasks` — 18 endpoints, see `FEATURE_MAP.md`
- `/api/chat` — `projects/:project_id/members` (GET, POST `{username}`, DELETE `:user_id`), `shared-projects` (GET), `projects/:project_id/messages` (GET `limit`/`cursor`, POST `{body}`, DELETE `:id`), FEAT-08a `unread` (GET, `{items: [{project_id, unread_count}], total}`, counts capped at 100) and `projects/:project_id/read` (PUT `{message_id}`, never moves back) (9). Responses `{status:'success', data}`; shapes and socket frames in `API_CONTRACT.chat` and `FEATURE_MAP.md`. WebSocket `/api/chat/ws` (not counted): Origin = `FRONTEND_URL`, first frame `{type:'auth', token}` within 5 s, close 4401 on bad auth or token expiry, `join`/`leave`, server frames `{type, data}`. Rooms are in memory (one instance)
- `/api/tokens` (FEAT-07a) — `GET` (list), `POST {name, expires_in_days}` (201, the only response with the secret), `DELETE :id` (revoke) (3). Responses `{status:'success', data}`; shapes in `API_CONTRACT.tokens.fields`
- `/mcp` (not counted, not under `/api`) — the MCP endpoint, personal access tokens only
- `/api/notifications` — `GET` (list: `limit`, opaque `cursor`; `{items, unread_count, next_cursor}`), `PATCH read-all`, `PATCH :notif_id/read` (idempotent; unknown or foreign id is 404), `GET sse` (typed `notification` events with `id:`, 25 s `ping`, ends at token `exp`), `DELETE clear/:user_id` (5). The list is the source of truth; the stream only signals. FEAT-08a adds `event: chat` (data `{project_id}`) when the user's chat unread counts changed; refetch `GET /api/chat/unread`. Frames without a notification id (`ping`, `chat`) get Nest's own counter as `id:`, so `Last-Event-ID` is not a notification id and nothing reads it. `metadata` and `actionTarget` are never exposed
- Everything except `GET /`, `refresh`, `create`, `loginEmail`, `loginUsername`, the two notification routes and `/mcp` uses `AuthorizeGuard` (`/mcp` uses `requireBearerAuth` with personal access tokens)

## Commands
- `pnpm start:dev` — dev server with watch
- `pnpm build` — production build
- `npm test` — jest unit specs (`*.spec.ts`, pure, no DB)
- `pnpm test:int` — integration tests against the Docker Postgres (`getitdone_test`, created on demand); run `pnpm db:up` first
- `npm run lint` — ESLint with auto-fix (local); `npm run lint:check` — no autofix, used by CI (errors fail, `no-unsafe-*` warnings are baseline debt)
- `npm run typecheck` — `tsc -p tsconfig.check.json` over `src`, `test` and `scripts`
- `pnpm migration:generate`, `pnpm migration:run`, `pnpm migration:revert` — TypeORM migrations
- `npm run start:render` — Render's start command: compiled `migration:run`, then `node dist/main` (after `npm run build`)
- Schema drift against a database (read-only): `node -r ts-node/register -r tsconfig-paths/register node_modules/typeorm/cli.js schema:log -d src/data-source.ts` (the entities import `src/...`, so plain `typeorm-ts-node-commonjs` fails)

## CI
- GitHub Actions `.github/workflows/ci.yml` on every PR and on pushes to `master`: job `check` (`npm ci`, `lint:check`, `typecheck`, `npm test`) and job `integration` (`npm run test:int` against a `postgres:17` service container; no secrets, `int-env.ts` sets everything). `.git-blame-ignore-revs` lists the prettier commit.
- Test pyramid: unit specs (`*.spec.ts`, pure, no DB); integration (`test/*.int-spec.ts`, real Postgres, real HTTP); no e2e. New features add tests at the lowest level that covers them.

## CodeGraph
The repo is indexed (`.codegraph/`). Query with `codegraph_explore` and `projectPath` set to this repo.

## Maintenance
- New file: update `CODEBASE_INDEX.md`
- New endpoint or feature: update `FEATURE_MAP.md`
- Architecture change: update `docs/ARCHITECTURE.md`
