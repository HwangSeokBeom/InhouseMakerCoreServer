import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { RiotController } from './riot.controller';
import { RiotApiClient } from './riot-api.client';
import { RiotProcessor } from './riot.processor';
import { RiotService } from './riot.service';

@Module({
  imports: [HttpModule],
  controllers: [RiotController],
  providers: [RiotApiClient, RiotService, RiotProcessor],
  exports: [RiotApiClient, RiotService],
})
export class RiotModule {}
