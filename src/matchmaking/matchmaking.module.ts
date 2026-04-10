import { Module } from '@nestjs/common';

import { MatchModule } from '../matches/matches.module';
import { PowerModule } from '../power/power.module';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingAlgorithmService } from './matchmaking-algorithm.service';
import { MatchmakingService } from './matchmaking.service';

@Module({
  imports: [MatchModule, PowerModule],
  controllers: [MatchmakingController],
  providers: [MatchmakingService, MatchmakingAlgorithmService],
})
export class MatchmakingModule {}
