import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../queue/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly queueService: QueueService,
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
    queues: string;
    timestamp: string;
  }> {
    await this.prismaService.$queryRaw`SELECT 1`;
    const redis = await this.redisService.ping();
    const queues = await this.queueService.getQueuesHealth();

    return {
      status: 'ready',
      database: 'ok',
      redis,
      queues,
      timestamp: new Date().toISOString(),
    };
  }
}
