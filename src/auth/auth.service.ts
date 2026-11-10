import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { from, Observable } from 'rxjs';
import { User } from 'src/user/models/user.interface';
import { TokenPayload } from './Interfaces/tokenPayload';
import { AuthTokenEntity } from './models/auth.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/models/user.entity';
import { decryptReplay, encryptReplay, safeEqual, sha256Hex } from './token-crypto';
const bcrypt = require('bcrypt');

export interface TokenPair {
    access_token: string;
    refresh_token: string;
    access_expires_in: number;
    refresh_expires_in: number;
    /** Legacy: kept only so the previously deployed FE keeps working. Remove in cleanup. */
    expires_in: number;
}

export interface IssuedRefreshToken {
    token: string;
    tokenId: string;
    expiresIn: number;
    expiresAt: Date;
}

type RefreshVerdict =
    | { kind: 'ok'; pair: TokenPair }
    | { kind: 'invalid' }
    | { kind: 'reused' };

const MAX_REFRESH_TOKEN_LENGTH = 4096;
const MAX_REPLAY_HOPS = 5;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly dataSource: DataSource,
        @InjectRepository(AuthTokenEntity)
        private readonly authTokenRepository: Repository<AuthTokenEntity>,
        @InjectRepository(UserEntity)
        private readonly usersRepository: Repository<UserEntity>,
    ){}

    // ---------------------------------------------------------------- config

    private refreshSecret(): string {
        const secret = this.configService.get<string>('JWT_REFRESH_SECRET');
        if (!secret) {
            throw new Error('JWT configuration missing: ensure JWT_REFRESH_SECRET is set');
        }
        return secret;
    }

    private graceMs(): number {
        const raw = Number(this.configService.get('REFRESH_REUSE_GRACE_SECONDS') ?? 30);
        return (Number.isFinite(raw) && raw >= 0 ? raw : 30) * 1000;
    }

    // ---------------------------------------------------------------- access

    /** Lifetime comes from the signed token itself (`exp - iat`). */
    generateAccessToken(user: User): { token: string; expiresIn: number } {
        try {
            const payload: TokenPayload = {
                user,
                sub: String(user.user_id),
                type: 'access',
                jti: crypto.randomUUID(),
            };

            const expiresIn = this.configService.get<JwtSignOptions['expiresIn']>('JWT_ACCESS_EXPIRATION');
            const secret = this.configService.get<string>('JWT_SECRET');
            if (!expiresIn || !secret) {
                throw new Error('JWT configuration missing: ensure JWT_ACCESS_EXPIRATION and JWT_SECRET are set');
            }

            const token = this.jwtService.sign(payload, { expiresIn, secret });
            return { token, expiresIn: this.lifetimeOf(token) };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error(String(error));
            throw new Error('Failed to generate access token', { cause: err });
        }
    }

    private lifetimeOf(token: string): number {
        const d = this.jwtService.decode(token) as { exp: number; iat: number } | null;
        if (!d?.exp || !d?.iat) {
            throw new Error('Signed token has no exp/iat');
        }
        return d.exp - d.iat;
    }

    hashPassword(password: string): Observable <String>{
        return from<String>(bcrypt.hash(password, 12));
    }

    comparePasswords(newPassword: string, passwordHash: string): Observable <any | boolean>{
        return from<any | boolean>(bcrypt.compare(newPassword, passwordHash));
    }

    // --------------------------------------------------------------- refresh

    /**
     * Signs and stores a refresh token. Login starts a new family; rotation
     * passes `familyId` so the family is inherited.
     */
    async generateRefreshToken(
        user: User,
        opts: { ip?: string | null; rememberMe?: boolean; familyId?: string },
        manager?: EntityManager,
    ): Promise<IssuedRefreshToken> {
        const rememberMe = opts.rememberMe === true;
        const tokenId = crypto.randomUUID();
        const expiresInCfg = rememberMe
            ? (this.configService.get<string>('JWT_REFRESH_EXPIRATION') ?? '7d')
            : (this.configService.get<string>('JWT_REFRESH_EXPIRATION_SHORT') ?? '1d');

        const token = this.jwtService.sign(
            { sub: user.user_id.toString(), jti: tokenId, type: 'refresh' },
            { expiresIn: expiresInCfg as JwtSignOptions['expiresIn'], secret: this.refreshSecret() },
        );
        const decoded = this.jwtService.decode(token) as { exp: number; iat: number };
        const expiresAt = new Date(decoded.exp * 1000);

        const repo = manager ? manager.getRepository(AuthTokenEntity) : this.authTokenRepository;
        const row = new AuthTokenEntity();
        row.token_id = tokenId;
        row.user_id = user.user_id.toString();
        row.token = sha256Hex(token);
        row.expires_at = expiresAt;
        row.is_revoked = false;
        row.revoked_at = null;
        row.replaced_by_token_id = null;
        row.replay_ciphertext = null;
        row.remember_me = rememberMe;
        row.ip_address = opts.ip ?? null;
        row.family_id = opts.familyId ?? crypto.randomUUID();
        await repo.save(row);

        return { token, tokenId, expiresIn: decoded.exp - decoded.iat, expiresAt };
    }

    /** Builds the login/refresh response pair. */
    buildPair(access: { token: string; expiresIn: number }, refresh: { token: string; expiresIn: number }): TokenPair {
        return {
            access_token: access.token,
            refresh_token: refresh.token,
            access_expires_in: access.expiresIn,
            refresh_expires_in: refresh.expiresIn,
            expires_in: 3600,
        };
    }

    private async hashMatches(token: string, stored: string): Promise<boolean> {
        if (stored.startsWith('$2')) {
            // Legacy bcrypt row. Remove in the cleanup PR once all have expired.
            return bcrypt.compare(token, stored);
        }
        return safeEqual(sha256Hex(token), stored);
    }

    private toTokenUser(user: UserEntity): User {
        const [firstname, ...lastnameParts] = user.fullname?.split(' ') || [];
        return {
            ...user,
            firstname: firstname || '',
            lastname: lastnameParts.join(' '),
        } as unknown as User;
    }

    private withinGrace(row: AuthTokenEntity, now: number): boolean {
        return !!row.revoked_at && now - row.revoked_at.getTime() <= this.graceMs();
    }

    /**
     * Idempotent, rotating refresh. Concurrent calls with the same token
     * serialize on a row lock; calls inside the grace window get the same
     * replacement refresh token back (with a fresh access token).
     */
    async refresh(refreshToken: unknown, ip: string | null): Promise<TokenPair> {
        const invalid = () => new UnauthorizedException({
            statusCode: 401, code: 'REFRESH_INVALID', message: 'Invalid refresh token.',
        });

        if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > MAX_REFRESH_TOKEN_LENGTH) {
            throw invalid();
        }
        let payload: { sub?: string; jti?: string; type?: string };
        try {
            payload = this.jwtService.verify(refreshToken, { secret: this.refreshSecret() });
        } catch (e) {
            if (e instanceof Error && e.message.includes('JWT configuration')) throw e;
            throw invalid();
        }
        if (payload.type !== 'refresh' || typeof payload.jti !== 'string') {
            throw invalid();
        }
        const jti = payload.jti;

        const verdict = await this.dataSource.transaction<RefreshVerdict>(async (m) => {
            const repo = m.getRepository(AuthTokenEntity);
            const row = await repo.findOne({
                where: { token_id: jti },
                lock: { mode: 'pessimistic_write' },
            });
            const now = Date.now();
            if (!row || row.expires_at.getTime() <= now || !(await this.hashMatches(refreshToken, row.token))) {
                return { kind: 'invalid' };
            }

            const user = await m.getRepository(UserEntity).findOne({ where: { user_id: row.user_id } });
            if (!user) return { kind: 'invalid' };
            const tokenUser = this.toTokenUser(user);

            if (!row.is_revoked) {
                const newRefresh = await this.generateRefreshToken(
                    tokenUser,
                    { ip, rememberMe: row.remember_me, familyId: row.family_id },
                    m,
                );
                row.is_revoked = true;
                row.revoked_at = new Date();
                row.replaced_by_token_id = newRefresh.tokenId;
                row.replay_ciphertext = encryptReplay(newRefresh.token, this.refreshSecret());
                await repo.save(row);
                return { kind: 'ok', pair: this.buildPair(this.generateAccessToken(tokenUser), newRefresh) };
            }

            // Revoked row.
            if (!row.replaced_by_token_id) return { kind: 'invalid' }; // logout / family revoked

            if (!this.withinGrace(row, now)) {
                // Reuse detected: revoke the whole family.
                await repo.update(
                    { family_id: row.family_id, is_revoked: false },
                    { is_revoked: true, revoked_at: new Date() },
                );
                this.logger.warn(`Refresh reuse detected user_id=${row.user_id} family_id=${row.family_id}`);
                return { kind: 'reused' };
            }

            // Within grace: walk to the newest revoked row whose replacement is still active.
            let cur = row;
            for (let hop = 0; hop < MAX_REPLAY_HOPS; hop++) {
                if (!cur.replaced_by_token_id || !this.withinGrace(cur, now)) return { kind: 'invalid' };
                const next = await repo.findOne({ where: { token_id: cur.replaced_by_token_id } });
                if (!next) return { kind: 'invalid' };
                if (next.is_revoked) {
                    cur = next;
                    continue;
                }
                if (next.expires_at.getTime() <= now || !cur.replay_ciphertext) return { kind: 'invalid' };
                const replay = decryptReplay(cur.replay_ciphertext, this.refreshSecret());
                if (!replay || !(await this.hashMatches(replay, next.token))) return { kind: 'invalid' };
                const decoded = this.jwtService.decode(replay) as { exp: number } | null;
                if (!decoded?.exp) return { kind: 'invalid' };
                const remaining = Math.floor(decoded.exp - now / 1000);
                if (remaining <= 0) return { kind: 'invalid' };
                return {
                    kind: 'ok',
                    pair: this.buildPair(this.generateAccessToken(tokenUser), { token: replay, expiresIn: remaining }),
                };
            }
            return { kind: 'invalid' };
        });

        if (verdict.kind === 'ok') return verdict.pair;
        if (verdict.kind === 'reused') {
            throw new UnauthorizedException({
                statusCode: 401, code: 'REFRESH_REUSED', message: 'Refresh token was already used.',
            });
        }
        throw invalid();
    }

    /** Revokes the token's whole family. Never throws, no oracle. */
    async logout(refreshToken: unknown): Promise<void> {
        try {
            if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > MAX_REFRESH_TOKEN_LENGTH) return;
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.refreshSecret(),
                ignoreExpiration: true,
            }) as { jti?: string; type?: string };
            if (payload.type !== 'refresh' || typeof payload.jti !== 'string') return;
            const row = await this.authTokenRepository.findOne({ where: { token_id: payload.jti } });
            if (!row) return;
            await this.authTokenRepository.update(
                { family_id: row.family_id, is_revoked: false },
                { is_revoked: true, revoked_at: new Date() },
            );
        } catch (error: any) {
            this.logger.warn(`Logout revoke failed: ${error?.message}`);
        }
    }

    async revokeUserRefreshTokens(userId: string): Promise<void> {
        await this.authTokenRepository.update(
            { user_id: userId, is_revoked: false },
            { is_revoked: true, revoked_at: new Date() },
        );
    }
}
