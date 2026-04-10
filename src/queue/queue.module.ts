import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.RIOT_SYNC },
      { name: QUEUE_NAMES.POWER },
      { name: QUEUE_NAMES.RESULT },
      { name: QUEUE_NAMES.NOTIFICATION },
    ),
  ],
  providers: [RedisService, QueueService],
  exports: [RedisService, QueueService, BullModule],
})
export class QueueModule {}
