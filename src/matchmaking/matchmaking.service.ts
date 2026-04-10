import { BadRequestException, Injectable } from '@nestjs/common';
import { Position } from '@prisma/client';

import { MatchesService } from '../matches/matches.service';
import { PowerService } from '../power/power.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaJson } from '../common/prisma-json.util';
import {
  AutoBalanceDto,
  MatchmakingCandidatesResponseDto,
  RerollDto,
} from './dto/matchmaking.dto';
import {
  AlgorithmPlayer,
  MatchmakingAlgorithmService,
} from './matchmaking-algorithm.service';

@Injectable()
export class MatchmakingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly powerService: PowerService,
    private readonly algorithmService: MatchmakingAlgorithmService,
  ) {}

  async autoBalance(
    requesterUserId: string,
    matchId: string,
    dto: AutoBalanceDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    return this.generateAndPersistCandidates(matchId, dto.lockedPlayerIds ?? [], []);
  }

  async reroll(
    requesterUserId: string,
    matchId: string,
    dto: RerollDto,
  ): Promise<MatchmakingCandidatesResponseDto> {
    await this.matchesService.assertMatchHostOrCaptain(matchId, requesterUserId);
    return this.generateAndPersistCandidates(
      matchId,
      dto.lockedPlayerIds ?? [],
      dto.excludeCandidateIds ?? [],
    );
  }

  private async generateAndPersistCandidates(
    matchId: string,
    lockedPlayerIds: string[],
    excludedCandidateIds: string[],
  ): Promise<MatchmakingCandidatesResponseDto> {
    const match = await this.matchesService.getMatchWithPlayers(matchId);

    if (match.players.length !== 10) {
      throw new BadRequestException('Auto-balance requires exactly 10 players.');
    }

    const userIds = match.players.map((player) => player.userId);
    const powerMap = await this.powerService.getPowerMapForUsers(userIds);

    const players: AlgorithmPlayer[] = match.players.map((player) => ({
      userId: player.userId,
      nickname: player.user.nickname,
      primaryPosition: player.user.primaryPosition,
      secondaryPosition: player.user.secondaryPosition,
      isFillAvailable: player.user.isFillAvailable,
      overallPower: powerMap.get(player.userId)?.overallPower ?? 50,
      lanePower: powerMap.get(player.userId)?.lanePower ?? this.defaultLanePower(50),
      sameTeamPreferenceUserIds: this.toStringArray(player.sameTeamPreferencesJson),
      avoidTeamPreferenceUserIds: this.toStringArray(player.avoidTeamPreferencesJson),
      lockedTeamSide: lockedPlayerIds.includes(player.userId) ? player.teamSide : null,
      lockedRole: lockedPlayerIds.includes(player.userId) ? player.assignedRole : null,
    }));

    const candidates = this.algorithmService.generateCandidates(players, excludedCandidateIds);

    if (candidates.length === 0) {
      throw new BadRequestException(
        'No valid team split was found. Check locked players and position coverage.',
      );
    }

    await this.prismaService.inhouseMatch.update({
      where: { id: matchId },
      data: {
        candidatesJson: toPrismaJson(candidates),
        balanceMode: candidates[0].type,
      },
    });

    return { candidates };
  }

  private defaultLanePower(overallPower: number): Record<string, number> {
    return {
      [Position.TOP]: overallPower,
      [Position.JUNGLE]: overallPower,
      [Position.MID]: overallPower,
      [Position.ADC]: overallPower,
      [Position.SUPPORT]: overallPower,
    };
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}
