import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { MatchResponseDto } from '../matches/dto/matches.dto';
import { MatchesService } from '../matches/matches.service';
import {
  AutoBalanceDto,
  MatchmakingCandidatesResponseDto,
  RerollDto,
  SelectCandidateDto,
} from './dto/matchmaking.dto';
import { MatchmakingService } from './matchmaking.service';

@ApiTags('matchmaking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchmakingController {
  constructor(
    private readonly matchmakingService: MatchmakingService,
    private readonly matchesService: MatchesService,
  ) {}

  @Post(':matchId/auto-balance')
  @ApiOperation({ summary: 'Generate auto-balance candidates for a match.' })
  @ApiOkResponse({ type: MatchmakingCandidatesResponseDto })
  autoBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: AutoBalanceDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    return this.matchmakingService.autoBalance(user.userId, matchId, dto);
  }

  @Post(':matchId/reroll')
  @ApiOperation({ summary: 'Generate a new set of auto-balance candidates.' })
  @ApiOkResponse({ type: MatchmakingCandidatesResponseDto })
  reroll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: RerollDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    return this.matchmakingService.reroll(user.userId, matchId, dto);
  }

  @Post(':matchId/select-candidate')
  @ApiOperation({ summary: 'Select one matchmaking candidate and assign teams.' })
  @ApiOkResponse({ type: MatchResponseDto })
  selectCandidate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: SelectCandidateDto,
  ) {
    return this.matchesService.assignCandidate(user.userId, matchId, dto.candidateNo);
  }
}
