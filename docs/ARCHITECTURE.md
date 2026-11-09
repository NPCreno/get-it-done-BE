# Architecture — Backend

## Module dependency
`AppModule` imports `ScheduleModule.forRoot()`, `ConfigModule` (global), `TypeOrmModule.forRoot` (PostgreSQL, `autoLoadEntities`), `EventEmitterModule`, and the feature modules: `AuthModule`, `UserModule`, `ProjectsModule`, `TaskModule`, `NotificationsModule`.

## Request pipeline
Request → (CORS from `FRONTEND_URL`) → route → `AuthorizeGuard` on protected controllers → controller → service → TypeORM repositories → PostgreSQL.

`AuthorizeGuard` extracts the Bearer token and calls `jwtService.verifyAsync`. The frontend middleware is only a UX layer; this guard is the security boundary.

## Authentication
- Login returns an access token (`JWT_SECRET`, lifetime `JWT_ACCESS_EXPIRATION`) and a refresh token (`JWT_REFRESH_SECRET`, `1d` or `7d` with `rememberMe`).
- Refresh tokens are stored hashed in `AuthTokenEntity` with `ip_address`, and rotated on every refresh.
- `JWT_REFRESH_SECRET` currently falls back to a hardcoded value when unset. Fix this so the service fails closed.

## Client IP
`src/auth/client-ip.ts` returns the first non-empty value of `X-Client-IP` (set by the frontend BFF), `X-Real-IP` (set by the Railway proxy), then `req.ip`, truncated to 64 characters. It never blocks authentication; the value is stored for audit only. `X-Forwarded-For` is not trusted and no Express `trust proxy` setting is used. A caller that reaches the API directly can send its own `X-Client-IP`, which is acceptable for audit data but must never drive an auth decision.

## Entity relationships
```
User ─┬─< Project ─< TaskInstance
      ├─< TaskInstance ─< TaskSubInstance
      ├─< TaskSubInstance
      └─< Notification
TaskTemplate ─< TaskInstance        (onDelete: SET NULL)
AuthToken: stores user_id, hashed token, expiry, ip_address (no ORM relation)
```
Deleting a user cascades to projects, tasks, subtasks and notifications. Deleting a task instance cascades to its subtasks.

## Events and schedules
- `task.completed` is emitted by `TaskService` and consumed by `NotificationsService`.
- `TaskGeneratorService` runs daily at midnight and creates instances from templates.

## Database
PostgreSQL through TypeORM. `synchronize` is on only when `DATABASE_SYNCHRONIZE === 'true'`. Migration scripts are configured but `src/migrations/` does not exist yet, so staging and production need migrations created before `synchronize` is turned off.
