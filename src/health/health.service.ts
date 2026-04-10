import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../queue/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  getLiveness(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<{
    status: string;
    database: string;
    redis: string;
    timestamp: string;
  }> {
    await this.prismaService.$queryRaw`SELECT 1`;
    const redis = await this.redisService.ping();

    return {
      status: 'ready',
      database: 'ok',
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}

