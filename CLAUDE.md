# Get It Done — Backend API

## Stack
NestJS 11, TypeScript 5, Express platform, TypeORM 0.3, PostgreSQL

Package manager: npm (`packageManager: npm@10.9.2`, `package-lock.json`), which is also what the Dockerfile and Railway use. A migration to pnpm 11.28.9 like the FE is a separate follow-up; the old `pnpm@11.13.0` pin was a broken release.

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
- `src/config/env.validation.ts` — boot-time env validation (`validateEnv`, `validateDatabaseEnv`, `checkDatabaseUrl`)
- `src/auth/client-ip.ts` — `getClientIp(req)`, audit-only IP from request headers
- `src/user/user.controller.ts`, `user.service.ts` — login, signup, user CRUD
- `src/task/task.service.ts` — task CRUD and analytics queries
- `src/task/taskGenerator.service.ts` — daily cron that creates recurring task instances
- `src/notifications/notifications.service.ts` — `@OnEvent('task.completed')` listener
- `src/main.ts` — CORS (`FRONTEND_URL`, default `http://localhost:3000`), listens on `PORT` (default 8000)

## Entities (8)
- `UserEntity` (table `users`)
- `AuthTokenEntity` (`src/auth/models/auth.entity.ts`) — refresh token records: sha256 hash, `family_id`, `remember_me`, `revoked_at`, `replaced_by_token_id`, `replay_ciphertext`, nullable `ip_address`
- `ProjectEntity`
- `TaskTemplateEntity` — recurring task definitions
- `TaskInstanceEntity` — individual tasks
- `TaskSubInstanceEntity` — subtasks
- `NotificationsEntity` (table `notifications`)
- `UserAwardEntity` (`src/notifications/models/user-award.entity.ts`, table `user_awards`) — award ledger

## Relationships
- User 1→N Project, TaskInstance, TaskSubInstance, Notification, UserAward (all `onDelete: CASCADE`)
- Project 1→N TaskInstance (`CASCADE`)
- TaskTemplate 1→N TaskInstance (`SET NULL`)
- TaskInstance 1→N TaskSubInstance (`CASCADE`)

## Auth
- HS256. Access token signed with `JWT_SECRET`, lifetime from `JWT_ACCESS_EXPIRATION` (no default; the service throws if either is missing)
- Refresh token signed with `JWT_REFRESH_SECRET`. Lifetime `JWT_REFRESH_EXPIRATION` (default `7d`, Remember Me) or `JWT_REFRESH_EXPIRATION_SHORT` (default `1d`); `remember_me` is stored on the row and inherited on rotation. Stored as sha256 (legacy rows: bcrypt, starts with `$2`)
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRATION` are required at startup (see Environment); no fallbacks
- `POST /api/auth/refresh` is idempotent: `SELECT ... FOR UPDATE` on the token row. Active row: rotate (same `family_id`) and store an AES-GCM replay of the new token. Revoked within `REFRESH_REUSE_GRACE_SECONDS` (30): the same refresh token is replayed with a fresh access token. Revoked beyond grace with a replacement: family revoked, `401 REFRESH_REUSED`. Otherwise `401 REFRESH_INVALID`. Responses carry `access_expires_in` / `refresh_expires_in`; `expires_in: 3600` is legacy
- `POST /api/auth/logout {refreshToken}` revokes the family, always 204
- `AuthorizeGuard` 401s carry `code: TOKEN_MISSING | TOKEN_INVALID`, and a token with `type !== 'access'` is rejected. Other 401s (ownership checks) have no code
- `AuthMaintenanceService` (hourly cron) nulls expired replay ciphertext and deletes rows expired more than a day
- Client IP is audit data only. `getClientIp()` returns `X-Client-IP` only when `X-Internal-Secret` matches `INTERNAL_API_SECRET` and the value is a valid IP; otherwise `null`. No `X-Real-IP`/`req.ip` fallback. Never use the IP for an auth decision

## Database
- PostgreSQL through TypeORM, `autoLoadEntities: true`, connection from `DATABASE_URL`
- `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'` (local development only)
- Migrations are hand-written (`src/migrations/`); prod has never run them, so do not use `migration:generate`. Railway Pre-deploy Command: `npm run migration:run`. `src/data-source.ts` serves the TypeORM CLI

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
- `toTokenUser()` (`src/auth/token-user.ts`) is the only way to build a JWT user. Never spread the entity (it carries the password hash)
- Notifications: `GET sse` and `DELETE clear/:user_id` are guarded and scoped to the token user
- Awards are given once: `users.lifetime_completed_count` only goes up (+1 on a real transition to Complete, in the same transaction as the status change; never decremented), and each matched rule is recorded in `user_awards` (`awardKeyFor`, PK `(user_id, award_key)`) in the same transaction as its notification. Clearing notifications never touches the ledger. Streak awards are once per streak run. Known gap: no outbox, so a crash between commit and the `task.completed` listener loses that completion's awards
- Password changes are bcrypt-hashed (cost 12). Migration `HashPlaintextPasswords` fixes old plaintext rows; `npm run db:rehash-passwords` is the idempotent straggler script
- Tests: `pnpm test` (contract and body-DTO unit specs), `pnpm test:int` (authorization, contract, migration, auth). `WRITE_FIXTURES=1 pnpm test:int` rewrites `test/fixtures/responses/`

## Environment
Validated at boot by `src/config/env.validation.ts` (`validateEnv`, called in `main.ts` before `AppModule` is loaded; any error prints the variable names and rules, never values, and exits 1). The migration CLI (`data-source.ts`) checks `DATABASE_URL` with the same `checkDatabaseUrl`. Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRATION`. Expiries need a unit (`15m`, `3600s`; a bare number is milliseconds to jsonwebtoken). Strict: `DATABASE_SYNCHRONIZE` is exactly `true`/`false`; `PORT` 1-65535; `REFRESH_REUSE_GRACE_SECONDS` 0-3600. `NODE_ENV` is `development|test|production` (default `development` locally, but required when `RAILWAY_ENVIRONMENT_NAME` or `RAILWAY_PROJECT_ID` is present). Production-only: `FRONTEND_URL` required, an origin only and not local (`FRONTEND_URL_ALLOW_LOCAL=true` opts out for a smoke test), and `DATABASE_SYNCHRONIZE=true` is an error; secrets under 32 characters or equal only warn. `AppEnv` is a diagnostic view; readers keep their own reads and defaults. A good boot logs `[Env] configuration valid (NODE_ENV=...)`.
`NODE_ENV`, `FRONTEND_URL_ALLOW_LOCAL`, `DATABASE_URL`, `DATABASE_SYNCHRONIZE`, `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION`, `JWT_REFRESH_EXPIRATION_SHORT`, `REFRESH_REUSE_GRACE_SECONDS`, `INTERNAL_API_SECRET`, `FRONTEND_URL`, `PORT`

## API endpoints (38)
- `GET /` — health check (1)
- `/api/auth` — `POST refresh`, `POST logout` (2)
- `/api/user` — create, loginEmail, loginUsername, get/:id, getAll, delete :id, :id/hard, update/:user_id (8)
- `/api/projects` — getAll, getAll/:user_id, :project_id (get, patch, delete), create, :project_id/hard (7)
- `/api/tasks` — 18 endpoints, see `FEATURE_MAP.md`
- `/api/notifications` — `GET sse` (SSE), `DELETE clear/:user_id` (2)
- Everything except `GET /`, `refresh`, `create`, `loginEmail`, `loginUsername` and the two notification routes uses `AuthorizeGuard`

## Commands
- `pnpm start:dev` — dev server with watch
- `pnpm build` — production build
- `npm test` — jest unit specs (`*.spec.ts`, pure, no DB)
- `pnpm test:int` — integration tests against the Docker Postgres (`getitdone_test`, created on demand); run `pnpm db:up` first
- `npm run lint` — ESLint with auto-fix (local); `npm run lint:check` — no autofix, used by CI (errors fail, `no-unsafe-*` warnings are baseline debt)
- `npm run typecheck` — `tsc -p tsconfig.check.json` over `src`, `test` and `scripts`
- `pnpm migration:generate`, `pnpm migration:run`, `pnpm migration:revert` — TypeORM migrations

## CI
- GitHub Actions `.github/workflows/ci.yml` on every PR and on pushes to `master`: job `check` (`npm ci`, `lint:check`, `typecheck`, `npm test`) and job `integration` (`npm run test:int` against a `postgres:17` service container; no secrets, `int-env.ts` sets everything). `.git-blame-ignore-revs` lists the prettier commit.
- Test pyramid: unit specs (`*.spec.ts`, pure, no DB); integration (`test/*.int-spec.ts`, real Postgres, real HTTP); no e2e. New features add tests at the lowest level that covers them.

## CodeGraph
The repo is indexed (`.codegraph/`). Query with `codegraph_explore` and `projectPath` set to this repo.

## Maintenance
- New file: update `CODEBASE_INDEX.md`
- New endpoint or feature: update `FEATURE_MAP.md`
- Architecture change: update `docs/ARCHITECTURE.md`
