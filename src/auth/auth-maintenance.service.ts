import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { AuthTokenEntity } from './models/auth.entity';

@Injectable()
export class AuthMaintenanceService {
  private readonly logger = new Logger(AuthMaintenanceService.name);

  constructor(
    @InjectRepository(AuthTokenEntity)
    private readonly repo: Repository<AuthTokenEntity>,
    private readonly config: ConfigService,
  ) {}

  /** Drops replay ciphertext past the grace window and deletes long-expired rows. */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanup(): Promise<void> {
    try {
      const graceSec = Number(this.config.get('REFRESH_REUSE_GRACE_SECONDS') ?? 30) || 30;
      await this.repo.update(
        { replay_ciphertext: Not(IsNull()), revoked_at: LessThan(new Date(Date.now() - graceSec * 1000)) },
        { replay_ciphertext: null },
      );
      const res = await this.repo.delete({ expires_at: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000)) });
      if (res.affected) this.logger.log(`Deleted ${res.affected} expired auth token rows`);
    } catch (error: any) {
      this.logger.warn(`Auth token cleanup failed: ${error?.message}`);
    }
  }
}
