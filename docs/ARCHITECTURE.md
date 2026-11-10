# Architecture — Backend

## Module dependency
`AppModule` imports `ScheduleModule.forRoot()`, `ConfigModule` (global), `TypeOrmModule.forRoot` (PostgreSQL, `autoLoadEntities`), `EventEmitterModule`, and the feature modules: `AuthModule`, `UserModule`, `ProjectsModule`, `TaskModule`, `NotificationsModule`.

## Request pipeline
Request → (CORS from `FRONTEND_URL`) → route → `AuthorizeGuard` on protected controllers → controller → service → TypeORM repositories → PostgreSQL.

`AuthorizeGuard` extracts the Bearer token, calls `jwtService.verifyAsync` and requires `type === 'access'`. Its 401s carry `code: TOKEN_MISSING | TOKEN_INVALID`, which is how the frontend tells a token problem from an ownership 401. The frontend middleware is only a UX layer; this guard is the security boundary.

## Authentication
- Login returns an access token (`JWT_SECRET`, lifetime `JWT_ACCESS_EXPIRATION`) and a refresh token (`JWT_REFRESH_SECRET`, `1d` or `7d` with `rememberMe`).
- Refresh tokens are stored as sha256 in `AuthTokenEntity` and rotated on every refresh, inheriting `family_id` and `remember_me`. Rotation runs under `SELECT ... FOR UPDATE`; the old row keeps an AES-GCM encrypted copy of its replacement for `REFRESH_REUSE_GRACE_SECONDS`, so a repeated refresh inside the window returns the same new refresh token. A repeat after the window revokes the family (`REFRESH_REUSED`).
- Lifetimes are read from the signed tokens (`exp - iat`) and returned as `access_expires_in` / `refresh_expires_in`, so cookie lifetimes can match.
- `JWT_REFRESH_SECRET` currently falls back to a hardcoded value when unset. Fix this so the service fails closed.

## Client IP
`src/auth/client-ip.ts` returns `X-Client-IP` only when `X-Internal-Secret` matches `INTERNAL_API_SECRET` (sent by the frontend BFF) and the value passes `net.isIP()`; otherwise `null`. There is no `X-Real-IP` or `req.ip` fallback. It never blocks authentication; the value is audit data only and must never drive an auth decision. The secret is not an auth control, so endpoints stay open to other clients.

## Entity relationships
```
User ─┬─< Project ─< TaskInstance
      ├─< TaskInstance ─< TaskSubInstance
      ├─< TaskSubInstance
      └─< Notification
TaskTemplate ─< TaskInstance        (onDelete: SET NULL)
AuthToken: stores user_id, sha256 token, expiry, family_id, remember_me, revoked_at, replaced_by_token_id, replay_ciphertext, ip_address (no ORM relation)
```
Deleting a user cascades to projects, tasks, subtasks and notifications. Deleting a task instance cascades to its subtasks.

## Events and schedules
- `task.completed` is emitted by `TaskService` and consumed by `NotificationsService`.
- `TaskGeneratorService` runs daily at midnight and creates instances from templates.

## Database
PostgreSQL through TypeORM. `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'`. Migration scripts are configured but `src/migrations/` does not exist yet, so staging and production need migrations created before `synchronize` is turned off.
