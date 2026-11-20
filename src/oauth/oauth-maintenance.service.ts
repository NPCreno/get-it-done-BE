import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Daily OAuth cleanup (FEAT-07c). Every rule keeps a margin past the point a
 * row stops working, so nothing usable is ever deleted:
 *  - codes expired more than a day ago
 *  - tokens expired more than 7 days ago
 *  - grants revoked or expired more than 30 days ago, and consents older than
 *    a day that never got a token (the code was never exchanged)
 *  - clients older than 7 days with no grant (DCR makes one per connection)
 */
@Injectable()
export class OAuthMaintenanceService {
  private readonly logger = new Logger('oauth');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    try {
      const run = async (name: string, sql: string) => {
        const [, n]: [unknown, number] = await this.dataSource.query(sql);
        counts[name] = n;
      };
      await run(
        'codes',
        `DELETE FROM "oauth_codes" WHERE "expires_at" < now() - interval '1 day'`,
      );
      await run(
        'tokens',
        `DELETE FROM "oauth_tokens" WHERE "expires_at" < now() - interval '7 days'`,
      );
      await run(
        'grants',
        `DELETE FROM "oauth_grants" g
          WHERE g."revoked_at" < now() - interval '30 days'
             OR g."expires_at" < now() - interval '30 days'
             OR (g."created_at" < now() - interval '1 day'
                 AND NOT EXISTS (SELECT 1 FROM "oauth_tokens" t WHERE t."grant_id" = g."id"))`,
      );
      await run(
        'clients',
        `DELETE FROM "oauth_clients" c
          WHERE c."created_at" < now() - interval '7 days'
            AND NOT EXISTS (SELECT 1 FROM "oauth_grants" g WHERE g."client_id" = c."id")`,
      );
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total > 0)
        this.logger.log(
          `cleanup deleted ${Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`,
        );
    } catch (error) {
      this.logger.warn(`OAuth cleanup failed: ${(error as Error)?.message}`);
    }
    return counts;
  }
}
