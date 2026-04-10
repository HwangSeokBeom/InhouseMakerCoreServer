import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module';
import { envValidationSchema } from './config/env.validation';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { GroupModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { MatchModule } from './matches/matches.module';
import { NotificationModule } from './notifications/notifications.module';
import { PowerModule } from './power/power.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RecruitingModule } from './recruiting/recruiting.module';
import { ResultModule } from './results/results.module';
import { RiotModule } from './riot/riot.module';
import { UserModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    QueueModule,
    AuthModule,
    UserModule,
    RiotModule,
    PowerModule,
    GroupModule,
    MatchModule,
    MatchmakingModule,
    ResultModule,
    RecruitingModule,
    NotificationModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
