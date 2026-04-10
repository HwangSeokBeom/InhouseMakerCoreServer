import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QueueType, SnapshotType, VerificationStatus } from '@prisma/client';

import { toPrismaJson } from '../common/prisma-json.util';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRiotAccountDto, RiotAccountListResponseDto, RiotAccountResponseDto } from './dto/riot-account.dto';
import { RiotApiClient } from './riot-api.client';

type MatchParticipant = Record<string, unknown>;

@Injectable()
export class RiotService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly riotApiClient: RiotApiClient,
    private readonly queueService: QueueService,
  ) {}

  async createForUser(
    userId: string,
    dto: CreateRiotAccountDto,
  ): Promise<RiotAccountResponseDto> {
    const existing = await this.prismaService.riotAccount.findFirst({
      where: {
        userId,
        riotGameName: dto.riotGameName,
        tagLine: dto.tagLine,
      },
    });

    if (existing) {
      throw new ConflictException('This Riot account is already connected.');
    }

    const resolved = await this.riotApiClient.resolveAccountByRiotId(
      dto.riotGameName,
      dto.tagLine,
    );

    const alreadyClaimed = await this.prismaService.riotAccount.findUnique({
      where: { puuid: resolved.puuid },
    });

    if (alreadyClaimed) {
      throw new ConflictException('This Riot account has already been linked.');
    }

    const existingPrimary = await this.prismaService.riotAccount.findFirst({
      where: { userId, isPrimary: true },
      select: { id: true },
    });

    if (dto.isPrimary || !existingPrimary) {
      await this.prismaService.riotAccount.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const created = await this.prismaService.riotAccount.create({
      data: {
        userId,
        riotGameName: dto.riotGameName,
        tagLine: dto.tagLine,
        region: dto.region,
        puuid: resolved.puuid,
        isPrimary: dto.isPrimary ?? !existingPrimary,
        verificationStatus: VerificationStatus.CLAIMED,
      },
    });

    await this.queueService.enqueueRiotAccountInitialSync(created.id);

    return this.toResponse(created);
  }

  async listForUser(userId: string): Promise<RiotAccountListResponseDto> {
    const items = await this.prismaService.riotAccount.findMany({
      where: { userId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return {
      items: items.map((item) => this.toResponse(item)),
    };
  }

  async enqueueSync(userId: string, riotAccountId: string): Promise<void> {
    const account = await this.prismaService.riotAccount.findFirst({
      where: { id: riotAccountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    await this.queueService.enqueueRiotAccountRefresh(riotAccountId);
  }

  async syncAccount(riotAccountId: string): Promise<void> {
    const account = await this.prismaService.riotAccount.findUnique({
      where: { id: riotAccountId },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    try {
      const summoner = await this.riotApiClient.getSummonerByPuuid(account.puuid);
      const [rankedEntries, recentMatchIds] = await Promise.all([
        this.riotApiClient.getRankedEntries(summoner.id),
        this.riotApiClient.getRecentMatchIds(account.puuid, 20),
      ]);
      const recentMatches = await Promise.all(
        recentMatchIds.slice(0, 10).map((matchId) => this.riotApiClient.getMatchDetail(matchId)),
      );

      const rankedSummary = this.buildRankedSummary(rankedEntries);
      const recentSummary = this.buildRecentSummary(account.puuid, recentMatches);

      await this.prismaService.$transaction([
        this.prismaService.riotAccount.update({
          where: { id: riotAccountId },
          data: {
            summonerId: summoner.id,
            lastSyncedAt: new Date(),
            lastSyncError: null,
          },
        }),
        this.prismaService.riotAccountSnapshot.create({
          data: {
            riotAccountId,
            snapshotType: SnapshotType.RANKED,
            queueType: QueueType.ALL,
            sampleSize: rankedEntries.length,
            tier: rankedSummary.primaryTier,
            rank: rankedSummary.primaryRank,
            lp: rankedSummary.primaryLp,
            metricsJson: toPrismaJson(rankedSummary),
          },
        }),
        this.prismaService.riotAccountSnapshot.create({
          data: {
            riotAccountId,
            snapshotType: SnapshotType.AGGREGATED,
            queueType: QueueType.ALL,
            sampleSize: Number(recentSummary.sampleSize ?? 0),
            metricsJson: toPrismaJson(recentSummary),
          },
        }),
      ]);

      await this.queueService.enqueuePowerRecalculation(account.userId, 'riot-sync');
    } catch (error) {
      await this.prismaService.riotAccount.update({
        where: { id: riotAccountId },
        data: {
          lastSyncError: error instanceof Error ? error.message : 'Unknown sync error',
        },
      });
      throw error;
    }
  }

  private buildRankedSummary(
    entries: Array<{
      queueType: string;
      tier: string;
      rank: string;
      leaguePoints: number;
      wins: number;
      losses: number;
    }>,
  ): Record<string, unknown> & {
    primaryTier?: string;
    primaryRank?: string;
    primaryLp?: number;
  } {
    const solo = entries.find((entry) => entry.queueType === 'RANKED_SOLO_5x5');
    const flex = entries.find((entry) => entry.queueType === 'RANKED_FLEX_SR');
    const primary = solo ?? flex;

    return {
      primaryTier: primary?.tier,
      primaryRank: primary?.rank,
      primaryLp: primary?.leaguePoints,
      queues: entries.map((entry) => ({
        queueType: entry.queueType,
        tier: entry.tier,
        rank: entry.rank,
        lp: entry.leaguePoints,
        winRate:
          entry.wins + entry.losses > 0
            ? Number((entry.wins / (entry.wins + entry.losses)).toFixed(4))
            : 0,
      })),
    };
  }

  private buildRecentSummary(
    puuid: string,
    matchDetails: Record<string, unknown>[],
  ): Record<string, unknown> {
    const participants = matchDetails
      .map((detail) => detail.info as { participants?: MatchParticipant[] } | undefined)
      .flatMap((info) => info?.participants ?? [])
      .filter((participant) => participant.puuid === puuid);

    const sampleSize = participants.length;
    const roleBuckets: Record<string, MatchParticipant[]> = {};

    for (const participant of participants) {
      const position = this.normalizePosition(
        String(participant.individualPosition ?? participant.teamPosition ?? 'FILL'),
      );
      roleBuckets[position] = [...(roleBuckets[position] ?? []), participant];
    }

    const laneMetrics = Object.entries(roleBuckets).reduce<Record<string, unknown>>(
      (acc, [position, bucket]) => {
        const totalWins = bucket.filter((item) => Boolean(item.win)).length;
        const totalKills = bucket.reduce((sum, item) => sum + Number(item.kills ?? 0), 0);
        const totalDeaths = bucket.reduce((sum, item) => sum + Number(item.deaths ?? 0), 0);
        const totalAssists = bucket.reduce((sum, item) => sum + Number(item.assists ?? 0), 0);
        const totalVision = bucket.reduce((sum, item) => sum + Number(item.visionScore ?? 0), 0);
        const totalGoldDiffAt10 = bucket.reduce(
          (sum, item) => sum + this.readChallengeNumber(item, 'goldPerMinute') / 30,
          0,
        );

        acc[position] = {
          matches: bucket.length,
          winRate: this.safeAverage(totalWins, bucket.length),
          kda: this.safeAverage(totalKills + totalAssists, Math.max(totalDeaths, 1)),
          visionScore: this.safeAverage(totalVision, bucket.length),
          laneInfluence: this.safeAverage(totalGoldDiffAt10, bucket.length),
        };
        return acc;
      },
      {},
    );

    const wins = participants.filter((item) => Boolean(item.win)).length;
    const totalKills = participants.reduce((sum, item) => sum + Number(item.kills ?? 0), 0);
    const totalDeaths = participants.reduce((sum, item) => sum + Number(item.deaths ?? 0), 0);
    const totalAssists = participants.reduce((sum, item) => sum + Number(item.assists ?? 0), 0);
    const totalVision = participants.reduce((sum, item) => sum + Number(item.visionScore ?? 0), 0);
    const totalKillParticipation = participants.reduce(
      (sum, item) => sum + this.readChallengeNumber(item, 'killParticipation'),
      0,
    );

    return {
      sampleSize,
      recentWinRate: this.safeAverage(wins, sampleSize),
      recentKda: this.safeAverage(totalKills + totalAssists, Math.max(totalDeaths, 1)),
      averageVisionScore: this.safeAverage(totalVision, sampleSize),
      averageKillParticipation: this.safeAverage(totalKillParticipation, sampleSize),
      laneMetrics,
    };
  }

  private normalizePosition(position: string): string {
    switch (position.toUpperCase()) {
      case 'TOP':
        return 'TOP';
      case 'JUNGLE':
        return 'JUNGLE';
      case 'MIDDLE':
      case 'MID':
        return 'MID';
      case 'BOTTOM':
      case 'ADC':
        return 'ADC';
      case 'UTILITY':
      case 'SUPPORT':
        return 'SUPPORT';
      default:
        return 'FILL';
    }
  }

  private readChallengeNumber(
    participant: MatchParticipant,
    key: string,
  ): number {
    const challenges = participant.challenges as Record<string, unknown> | undefined;
    return Number(challenges?.[key] ?? 0);
  }

  private safeAverage(total: number, count: number): number {
    return count > 0 ? Number((total / count).toFixed(4)) : 0;
  }

  private toResponse(account: {
    id: string;
    riotGameName: string;
    tagLine: string;
    region: string;
    puuid: string;
    isPrimary: boolean;
    verificationStatus: VerificationStatus;
    lastSyncedAt: Date | null;
  }): RiotAccountResponseDto {
    return {
      id: account.id,
      riotGameName: account.riotGameName,
      tagLine: account.tagLine,
      region: account.region,
      puuid: account.puuid,
      isPrimary: account.isPrimary,
      verificationStatus: account.verificationStatus,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    };
  }
}
