import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { BalancePreviewDto, MatchmakingCandidatesResponseDto } from './dto/matchmaking.dto';
import { MatchmakingService } from './matchmaking.service';

@ApiTags('matchmaking')
@Controller('matches')
export class MatchmakingPreviewController {
  constructor(private readonly matchmakingService: MatchmakingService) {}

  @Post('balance/preview')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'matches-balance-preview', limit: 20, windowSeconds: 60 })
  @ApiOperation({ summary: 'Preview 5:5 balance candidates without creating a server match.' })
  @ApiOkResponse({ type: MatchmakingCandidatesResponseDto })
  previewBalance(
    @Body() dto: BalancePreviewDto,
  ): MatchmakingCandidatesResponseDto {
    return this.matchmakingService.previewBalance(dto);
  }
}
