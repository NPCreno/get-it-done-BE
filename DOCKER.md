# Docker Setup for Get It Done Backend

This guide explains how to set up and run the Get It Done backend application using Docker Compose, including a PostgreSQL database.

## Prerequisites

- Docker 20.10.0 or later
- Docker Compose 2.0.0 or later
- Node.js 22 and pnpm 11.28.9 (for local development without Docker)

## Quick Start

1. **Create Environment File**
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file and fill in your environment variables.

2. **Start Development Environment**
   ```bash
   docker compose up --build
   ```
   This will:
   - Start a PostgreSQL 17 container
   - Build the backend image and start it (it boots with the `NODE_ENV` from `.env`, `development` by default, so `DATABASE_SYNCHRONIZE=true` creates the schema)

3. **Access the Application**
   - Backend API: http://localhost:8000
   - PostgreSQL: 127.0.0.1:5433 (`POSTGRES_PORT`), bound to localhost only
   - `POSTGRES_PASSWORD` must be set in `.env`: `docker compose` refuses to start without it

## Available Commands

### Development

Start services:
```bash
docker compose up
```

Start in detached mode (background):
```bash
docker compose up -d
```

Rebuild the containers:
```bash
docker compose up --build
```

Run a command in the container:
```bash
docker compose exec backend <command>
```

### Production

The `Dockerfile` has four stages on `node:22-alpine`:
- `base`: installs pnpm 11.28.9 and copies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `build`: `pnpm install --frozen-lockfile`, then `pnpm build`
- `deps`: `pnpm install --frozen-lockfile --prod` (production dependencies only; bcrypt uses its prebuilt musl binary, no compiler)
- `production`: only `dist`, the production `node_modules` and `package.json`, owned by and run as the non-root `node` user (uid 1000), `CMD ["node", "dist/main"]`

The image does not set `NODE_ENV`; pass it from the environment (`NODE_ENV=production` on Railway). Migrations in production run compiled, without ts-node:
```bash
node node_modules/typeorm/cli.js migration:run -d dist/data-source.js
```

Build production image:
```bash
docker build -t get-it-done-be:prod --target production .
```

Run production container:
```bash
docker run -p 8000:8000 --env-file .env get-it-done-be:prod
```

### Database Operations

Access PostgreSQL shell:
```bash
docker compose exec postgres psql -U postgres -d getitdone
```

View database logs:
```bash
docker compose logs -f postgres
```

## Environment Variables

Create a `.env` file based on `.env.example`. Required variables:

- `DATABASE_URL` - PostgreSQL connection URL
- `JWT_SECRET` - Secret key for JWT tokens
- `JWT_REFRESH_SECRET` - Secret key for refresh tokens
- `JWT_ACCESS_EXPIRATION` - Access token expiration time
- `JWT_REFRESH_EXPIRATION` - Refresh token expiration time
- `FRONTEND_URL` - URL of the frontend application
- `PORT` - Port the backend will run on (default: 8000)

## Database Persistence

Data is persisted in a Docker volume named `pgdata17` (Postgres 17). This means your data will survive container restarts.

### Moving data from the old Postgres 15 volume (`pgdata`)

The old volume is left untouched. No step below deletes a volume.

1. Start a throwaway Postgres 15 on the old volume (stop any container already using it first):
   `docker run --rm -d --name pg15-old -v <project>_pgdata:/var/lib/postgresql/data -e POSTGRES_PASSWORD=<old password> postgres:15`
   (find the exact volume name with `docker volume ls`).
2. Dump it: `docker exec pg15-old pg_dump -U postgres -d getitdone > getitdone.sql`, then `docker stop pg15-old`.
3. Start the new stack (`docker compose up -d postgres`) and restore into `127.0.0.1:5433` with `pnpm db:restore` or `psql`.

## Troubleshooting

### Port Conflicts
Edit the `docker-compose.yml` file to use different ports:
```yaml
services:
  backend:
    ports:
      - "8001:8000"  # Change the first number to an available port
  postgres:
    ports:
      - "5433:5432"  # Change the first number to an available port
```

### Clean Up

Remove all containers, networks, and volumes:
```bash
docker compose down -v
```

### Rebuild from Scratch
```bash
docker compose down -v
docker system prune -a
docker compose up --build
```

## Development Notes

- The backend container runs the built image; it does not mount your code. For a watch-mode dev server, run Postgres only (`pnpm db:up`) and `pnpm start:dev` natively
- Database migrations should be managed through your application's migration system
