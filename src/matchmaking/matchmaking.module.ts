import { Module } from '@nestjs/common';

import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { MatchModule } from '../matches/matches.module';
import { PowerModule } from '../power/power.module';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingPreviewController } from './matchmaking-preview.controller';
import { MatchmakingAlgorithmService } from './matchmaking-algorithm.service';
import { MatchmakingService } from './matchmaking.service';

@Module({
  imports: [MatchModule, PowerModule],
  controllers: [MatchmakingController, MatchmakingPreviewController],
  providers: [MatchmakingService, MatchmakingAlgorithmService, PublicThrottleGuard],
})
export class MatchmakingModule {}
