import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { API_CONTRACT } from 'src/common/api-contract';
import { generatePat, parsePat, secretMatches } from './pat-format';

export type TokenStatus = 'active' | 'expired' | 'revoked';

/** Public shape. Never the hash or the secret. */
export interface TokenDto {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: TokenStatus;
}

export interface CreatedTokenDto extends TokenDto {
  /** The full token: returned once, at creation, and never again. */
  token: string;
}

/** A verified token, as the MCP verifier needs it. */
export interface VerifiedToken {
  tokenId: string;
  userId: string;
  prefix: string;
  expiresAt: Date | null;
}

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  secret_hash: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

const PUBLIC_COLUMNS = `"id", "name", "prefix", "created_at", "last_used_at", "expires_at", "revoked_at"`;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_NOT_FOUND = 'Token not found';
export const TOO_MANY_TOKENS = `You can have at most ${API_CONTRACT.tokens.maxActive} active tokens.`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function tokenStatus(
  row: Pick<TokenRow, 'revoked_at' | 'expires_at'>,
  now = new Date(),
): TokenStatus {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) <= now) return 'expired';
  return 'active';
}

export function toTokenDto(row: Omit<TokenRow, 'user_id' | 'secret_hash'>) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    created_at: iso(row.created_at)!,
    last_used_at: iso(row.last_used_at),
    expires_at: iso(row.expires_at),
    revoked_at: iso(row.revoked_at),
    status: tokenStatus(row),
  } satisfies TokenDto;
}

/**
 * Personal access tokens (FEAT-07a). Managed through /api/tokens with the
 * website's JWT; accepted only by the MCP endpoint (McpModule's bearer
 * middleware). Logs carry the prefix at most, never a token or hash.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger('TokensService');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Newest first, every status. */
  async list(userId: string): Promise<TokenDto[]> {
    const rows: TokenRow[] = await this.dataSource.query(
      `SELECT ${PUBLIC_COLUMNS} FROM "personal_access_tokens"
        WHERE "user_id" = $1 ORDER BY "created_at" DESC, "id"`,
      [userId],
    );
    return rows.map(toTokenDto);
  }

  /**
   * At most `maxActive` active tokens per user. The users row lock serialises
   * concurrent creates for one user so the cap cannot be raced.
   */
  async create(
    userId: string,
    name: string,
    expiresInDays: number | null | undefined,
  ): Promise<CreatedTokenDto> {
    const days =
      expiresInDays === undefined
        ? API_CONTRACT.tokens.defaultExpiresInDays
        : expiresInDays;
    const expiresAt =
      days === null ? null : new Date(Date.now() + days * DAY_MS);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT 1 FROM "users" WHERE "user_id" = $1 FOR UPDATE`,
        [userId],
      );
      const [{ n }]: { n: number }[] = await manager.query(
        `SELECT count(*)::int AS n FROM "personal_access_tokens"
          WHERE "user_id" = $1 AND "revoked_at" IS NULL
            AND ("expires_at" IS NULL OR "expires_at" > now())`,
        [userId],
      );
      if (n >= API_CONTRACT.tokens.maxActive)
        throw new BadRequestException(TOO_MANY_TOKENS);
      // A prefix collision (62^10) is practically impossible; the unique
      // constraint would turn one into a failed request, never a shared prefix.
      const pat = generatePat();
      const rows: TokenRow[] = await manager.query(
        `INSERT INTO "personal_access_tokens"
           ("id", "user_id", "name", "prefix", "secret_hash", "expires_at")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${PUBLIC_COLUMNS}`,
        [randomUUID(), userId, name, pat.prefix, pat.secretHash, expiresAt],
      );
      this.logger.log(`token created prefix=${pat.prefix}`);
      return { ...toTokenDto(rows[0]), token: pat.token };
    });
  }

  /** Idempotent. A missing id and another user's id are the same 404. */
  async revoke(userId: string, id: string): Promise<TokenDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException(TOKEN_NOT_FOUND);
    const [rows]: [TokenRow[], number] = await this.dataSource.query(
      `UPDATE "personal_access_tokens"
          SET "revoked_at" = COALESCE("revoked_at", now())
        WHERE "id" = $1 AND "user_id" = $2
        RETURNING ${PUBLIC_COLUMNS}`,
      [id, userId],
    );
    if (rows.length === 0) throw new NotFoundException(TOKEN_NOT_FOUND);
    this.logger.log(`token revoked prefix=${rows[0].prefix}`);
    return toTokenDto(rows[0]);
  }

  /**
   * The token's owner if the token is well-formed, known, not revoked, not
   * expired and its user exists and is not deleted; otherwise null. The hash
   * is compared in constant time.
   */
  async verify(token: string): Promise<VerifiedToken | null> {
    const parts = parsePat(token);
    if (!parts) return null;
    const rows: TokenRow[] = await this.dataSource.query(
      `SELECT t."id", t."user_id", t."prefix", t."secret_hash",
              t."expires_at", t."revoked_at"
         FROM "personal_access_tokens" t
         JOIN "users" u ON u."user_id" = t."user_id" AND u."deletedAt" IS NULL
        WHERE t."prefix" = $1`,
      [parts.prefix],
    );
    const row = rows[0];
    if (!row || !secretMatches(parts.secret, row.secret_hash)) return null;
    if (tokenStatus(row) !== 'active') return null;
    return {
      tokenId: row.id,
      userId: row.user_id,
      prefix: row.prefix,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    };
  }

  /** Records use at most once a minute per token (one conditional UPDATE). */
  async touch(tokenId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "personal_access_tokens" SET "last_used_at" = now()
        WHERE "id" = $1
          AND ("last_used_at" IS NULL OR "last_used_at" < now() - interval '1 minute')`,
      [tokenId],
    );
  }
}
