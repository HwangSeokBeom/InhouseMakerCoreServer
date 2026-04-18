import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  AddMatchPlayersDto,
  CreateMatchDto,
  MatchResponseDto,
  MatchRematchInputResponseDto,
  RecentMatchListResponseDto,
  RecentMatchesQueryDto,
  SaveManualBalanceDto,
  MatchSummaryResponseDto,
  UpdateMatchPlayerDto,
} from './dto/matches.dto';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post('groups/:groupId/matches')
  @ApiOperation({ summary: 'Create an inhouse match for a group.' })
  @ApiCreatedResponse({ type: MatchResponseDto })
  createMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Body() dto: CreateMatchDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.createMatch(user.userId, groupId, dto);
  }

  @Get('matches/recent')
  @ApiOperation({ summary: 'List recent matches across groups the requester can access.' })
  @ApiOkResponse({ type: RecentMatchListResponseDto })
  listRecentMatches(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecentMatchesQueryDto,
  ): Promise<RecentMatchListResponseDto> {
    return this.matchesService.listRecentMatches(user.userId, query);
  }

  @Get('matches/:matchId')
  @ApiOperation({ summary: 'Get match details.' })
  @ApiOkResponse({ type: MatchResponseDto })
  getMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchResponseDto> {
    return this.matchesService.getMatch(user.userId, matchId);
  }

  @Get('matches/:matchId/rematch-input')
  @ApiOperation({ summary: 'Get a rematch-ready player snapshot for a past match.' })
  @ApiOkResponse({ type: MatchRematchInputResponseDto })
  getRematchInput(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchRematchInputResponseDto> {
    return this.matchesService.getRematchInput(user.userId, matchId);
  }

  @Post('matches/:matchId/players')
  @ApiOperation({ summary: 'Add players to a match.' })
  @ApiOkResponse({ type: MatchResponseDto })
  addPlayers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: AddMatchPlayersDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.addPlayers(user.userId, matchId, dto);
  }

  @Patch('matches/:matchId/players/:playerId')
  @ApiOperation({ summary: 'Update a locked or recruiting match player as admin/group admin.' })
  @ApiOkResponse({ type: MatchResponseDto })
  updatePlayer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Param('playerId') playerId: string,
    @Body() dto: UpdateMatchPlayerDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.updatePlayer(user.userId, matchId, playerId, dto);
  }

  @Post('matches/:matchId/lock')
  @ApiOperation({ summary: 'Lock a match roster before auto-balance.' })
  @ApiOkResponse({ type: MatchResponseDto })
  lockMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchResponseDto> {
    return this.matchesService.lockMatch(user.userId, matchId);
  }

  @Put('matches/:matchId/manual-balance')
  @ApiOperation({ summary: 'Persist a manual team balance assignment for a match.' })
  @ApiOkResponse({ type: MatchResponseDto })
  saveManualBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: SaveManualBalanceDto,
  ): Promise<MatchResponseDto> {
    return this.matchesService.saveManualBalance(user.userId, matchId, dto);
  }

  @Post('matches/:matchId/reopen')
  @ApiOperation({ summary: 'Reopen a locked or unconfirmed match for roster updates.' })
  @ApiOkResponse({ type: MatchResponseDto })
  reopenMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchResponseDto> {
    return this.matchesService.reopenMatch(user.userId, matchId);
  }

  @Get('matches/:matchId/summary')
  @ApiOperation({ summary: 'Get a compact match summary for app surfaces.' })
  @ApiOkResponse({ type: MatchSummaryResponseDto })
  getMatchSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
  ): Promise<MatchSummaryResponseDto> {
    return this.matchesService.getMatchSummary(user.userId, matchId);
  }
}
