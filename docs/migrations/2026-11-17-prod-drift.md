# Production schema drift (OPS-04, 2026-11-17)

What `synchronize` would change on production's schema, read with
`typeorm schema:log` (read-only: it prints SQL and runs nothing):

```
node -r ts-node/register -r tsconfig-paths/register node_modules/typeorm/cli.js schema:log -d src/data-source.ts
```

Production has never run a migration (no `migrations` table). Its schema came
from `synchronize` before DATA-01 and the award ledger, so the code on `master`
expects tables and columns that are not there.

## 1. Local rehearsal: copy of the Nov 9 production dump

Source: `db_dumps/neon_2026-11-09_2316.dump` (gitignored), restored into a
scratch local database. Entities as on `master` `5a61aa3` (task `id` still
integer). Password check (counts only): 8 users, 8 bcrypt, **0 non-bcrypt**.

### Before (20 statements)

```sql
CREATE TABLE "user_awards" ("user_id" character varying NOT NULL, "award_key" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_83cd1e9783e0165c00019d7bd59" PRIMARY KEY ("user_id", "award_key"));
CREATE TYPE "public"."notifications_type_enum" AS ENUM('achievement', 'milestone', 'streak', 'levelUp', 'reward', 'taskDue');
CREATE TYPE "public"."notifications_actiontype_enum" AS ENUM('acknowledge', 'complete', 'claim');
CREATE TABLE "notifications" ("id" SERIAL NOT NULL, "notif_id" character varying NOT NULL, "type" "public"."notifications_type_enum" NOT NULL, "title" character varying NOT NULL, "message" character varying, "read" boolean NOT NULL, "actionType" "public"."notifications_actiontype_enum", "actionTarget" character varying, "metadata" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "user_id" character varying, CONSTRAINT "UQ_7a5ca2b2ac8d7a28e7ecd975e0c" UNIQUE ("notif_id"), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"));
CREATE INDEX "IDX_7a5ca2b2ac8d7a28e7ecd975e0" ON "notifications" ("notif_id");
CREATE INDEX "IDX_9a8a82462cab47c73d25f49261" ON "notifications" ("user_id");
CREATE INDEX "IDX_f8b7ed75170d2d7dca4477cc94" ON "notifications" ("read");
CREATE INDEX "IDX_831a5a06f879fb0bebf8965871" ON "notifications" ("createdAt");
ALTER TABLE "users" ADD "lifetime_completed_count" integer NOT NULL DEFAULT '0';
ALTER TABLE "auth_token_entity" ADD "revoked_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "auth_token_entity" ADD "replaced_by_token_id" character varying;
ALTER TABLE "auth_token_entity" ADD "replay_ciphertext" text;
ALTER TABLE "auth_token_entity" ADD "remember_me" boolean NOT NULL DEFAULT false;
ALTER TABLE "task_instance_entity" DROP CONSTRAINT "PK_f7191fddd77e29db19d81d16a61";
ALTER TABLE "task_instance_entity" DROP COLUMN "id";
ALTER TABLE "task_instance_entity" ADD "id" SERIAL NOT NULL;
ALTER TABLE "task_instance_entity" ADD CONSTRAINT "PK_f7191fddd77e29db19d81d16a61" PRIMARY KEY ("id");
CREATE INDEX "IDX_c9e89f7dc8c617e892461f88a0" ON "auth_token_entity" ("user_id");
ALTER TABLE "user_awards" ADD CONSTRAINT "FK_d2a357040e13c154cda530604ae" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
```

Classification:
- `notifications` (2 enums, table, 4 indexes, FK): created by **CatchUpBaseline** (same DDL and names)
- `user_awards`, `users.lifetime_completed_count`: **AwardOnce**
- 4 token columns and the `user_id` index: **AuthTokenRotation**
- task `id` uuid→integer (drop + re-add, which would lose the column): **not done**; the entity is uuid instead
- Nothing else. No other dropped column or type change.

### After `start:render` on the branch code (4 statements)

Migrations: 4 found, 4 executed, in one transaction.

```
[CatchUpBaseline] created notifications (empty)
[HashPlaintextPasswords] rehashed 0 account(s)
[AwardOnce] backfilled 0 award(s) from 0 notification row(s); 0 unmapped row(s)
```

```sql
ALTER TABLE "user_awards" DROP CONSTRAINT "user_awards_user_id_fkey";
DROP INDEX "public"."IDX_auth_token_entity_user_id";
CREATE INDEX "IDX_c9e89f7dc8c617e892461f88a0" ON "auth_token_entity" ("user_id");
ALTER TABLE "user_awards" ADD CONSTRAINT "FK_d2a357040e13c154cda530604ae" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
```

Leftovers are **names only**: AwardOnce names its FK `user_awards_user_id_fkey` and
AuthTokenRotation names its index `IDX_auth_token_entity_user_id`, where
synchronize would use hashed names. Same columns, same behavior; production
never runs synchronize, so nothing acts on them. Left as is (existing
migrations are never edited); a rename migration can align them later.

Smoke test against the app on that database (port 8010): signup, log in,
create a task, task list with a uuid string `id`, complete it (3 award
notifications), re-complete adds nothing, notifications list, token refresh:
**8/8 passed**.

## 2. Neon rehearsal branch `catchup-rehearsal` (A1 and A7)

Run on 2026-11-18 against the branch's direct host (checked first: the
rehearsal endpoint, no `-pooler`, not the production endpoint). The connection
string stayed in the git-ignored `.env.local`; `channel_binding` was stripped
in memory for the run.

### A1: before (entities as on `master` `5a61aa3`)

The same **20 statements** as section 1, line for line. No other drift.
Counts only: 8 users, 13 tasks, 7 token rows; no `migrations`,
`notifications` or `user_awards` table. Passwords: 8 bcrypt, **0 non-bcrypt**.

### A7: `npm run start:render` on the branch code

```
0 migrations are already loaded in the database.
4 migrations were found in the source code.
4 migrations are new migrations must be executed.
[CatchUpBaseline] created notifications (empty)
Migration CatchUpBaseline1762700000000 has been executed successfully.
Migration AuthTokenRotation1762800000000 has been executed successfully.
[HashPlaintextPasswords] rehashed 0 account(s)
Migration HashPlaintextPasswords1762900000000 has been executed successfully.
[AwardOnce] backfilled 0 award(s) from 0 notification row(s); 0 unmapped row(s)
Migration AwardOnce1763000000000 has been executed successfully.
```

Then the app started. A second `migration:run`: `No migrations are pending`.
Data kept: 8 users, 13 tasks, 7 token rows; `migrations` has 4 rows.

### A7: after

The same **4 name-only statements** as section 1 (the AwardOnce FK and the
AuthTokenRotation index names). Nothing else; the task `id` entry is gone.

### A7: smoke test (app on the branch, port 8010)

Signup, log in, create a task, task list with a uuid string `id`, complete it
(3 award notifications: Level Up!, 1-Day Streak, First Task Completed!),
re-complete adds nothing, notifications list, token refresh: **8/8 passed**.
No errors in the app log.
