import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RiotMatchHistoryRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async findKnownMatchIds(
    puuid: string,
    riotMatchIds: string[],
  ): Promise<Set<string>> {
    if (riotMatchIds.length === 0) {
      return new Set();
    }

    const rows = await this.prismaService.riotMatchParticipantSummary.findMany({
      where: {
        puuid,
        riotMatchId: {
          in: riotMatchIds,
        },
      },
      select: {
        riotMatchId: true,
      },
    });

    return new Set(rows.map((row) => row.riotMatchId));
  }

  async createParticipantSummaries(
    rows: Prisma.RiotMatchParticipantSummaryCreateManyInput[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await this.prismaService.riotMatchParticipantSummary.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  findChampionHistoryByPuuid(puuid: string, queueCategories?: string[]) {
    return this.prismaService.riotMatchParticipantSummary.findMany({
      where: {
        puuid,
        ...(queueCategories
          ? {
              queueCategory: {
                in: queueCategories,
              },
            }
          : {
              queueCategory: {
                not: 'IGNORED',
              },
            }),
      },
      select: {
        riotMatchId: true,
        queueCategory: true,
        championId: true,
        championKey: true,
        championName: true,
        kills: true,
        deaths: true,
        assists: true,
        didWin: true,
        playedAt: true,
        seasonKey: true,
      },
      orderBy: {
        playedAt: 'desc',
      },
    });
  }

  async getChampionHistoryDiagnosticsByPuuid(puuid: string): Promise<{
    totalMatches: number;
    rankedMatches: number;
    eligibleMatches: number;
    ignoredMatches: number;
    mappedMatches: number;
    rankedMappedMatches: number;
    eligibleMappedMatches: number;
    mappingFailureMatches: number;
    queueCounts: Record<string, number>;
  }> {
    const rows = await this.prismaService.riotMatchParticipantSummary.findMany({
      where: {
        puuid,
      },
      select: {
        queueCategory: true,
        championId: true,
        championKey: true,
        championName: true,
      },
    });
    const queueCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.queueCategory] = (acc[row.queueCategory] ?? 0) + 1;
      return acc;
    }, {});
    const rankedMatches = rows.filter((row) =>
      ['RANKED_SOLO', 'RANKED_FLEX'].includes(row.queueCategory),
    ).length;
    const ignoredMatches = rows.filter((row) => row.queueCategory === 'IGNORED').length;
    const eligibleMatches = rows.length - ignoredMatches;
    const mappedMatches = rows.filter((row) => this.hasChampionMapping(row)).length;
    const rankedMappedMatches = rows.filter(
      (row) =>
        ['RANKED_SOLO', 'RANKED_FLEX'].includes(row.queueCategory) &&
        this.hasChampionMapping(row),
    ).length;
    const eligibleMappedMatches = rows.filter(
      (row) => row.queueCategory !== 'IGNORED' && this.hasChampionMapping(row),
    ).length;

    return {
      totalMatches: rows.length,
      rankedMatches,
      eligibleMatches,
      ignoredMatches,
      mappedMatches,
      rankedMappedMatches,
      eligibleMappedMatches,
      mappingFailureMatches: rows.length - mappedMatches,
      queueCounts,
    };
  }

  private hasChampionMapping(row: {
    championId: number | null;
    championKey: string | null;
    championName: string | null;
  }): boolean {
    return (
      row.championId !== null ||
      Boolean(row.championKey?.trim()) ||
      Boolean(row.championName?.trim())
    );
  }
}
