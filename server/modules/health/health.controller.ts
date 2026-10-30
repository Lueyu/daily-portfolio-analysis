import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../common/platform';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  @Get()
  async readiness(): Promise<{ status: 'ok' }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service is unavailable');
    }
  }
}
