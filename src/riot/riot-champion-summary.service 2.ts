import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  TopChampionAggregationStatusDto,
  TopChampionSummaryDto,
} from './dto/top-champion.dto';
import { RiotMatchHistoryRepository } from './riot-match-history.repository';

type ChampionHistoryRow = Awaited<
  ReturnType<RiotMatchHistoryRepository['findChampionHistoryByPuuid']>
>[number];

type ChampionBucket = {
  championId: number | null;
  championKey: string;
  championName: string;
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  lastPlayedAtMs: number | null;
  latestSeasonGames: number;
};

type ChampionSummaryResult = {
  topChampions: TopChampionSummaryDto[];
  aggregationStatus: TopChampionAggregationStatusDto;
};

type ChampionAggregationDetail = {
  items: TopChampionSummaryDto[];
  thresholdUsed: number | null;
  fallbackThresholdsUsed: number[];
  bucketCount: number;
  mappingFailureCount: number;
};

type ChampionDiagnostics = Awaited<
  ReturnType<RiotMatchHistoryRepository['getChampionHistoryDiagnosticsByPuuid']>
>;

type RiotAccountForChampionSummary = {
  id: string;
  puuid: string;
  lastSyncedAt: Date | null;
  processedMatchCount: number;
  queuedMatchCount: number;
  hasUsableSnapshot: boolean;
  matchHistoryNextStart: number;
  matchHistoryComplete: boolean;
};

@Injectable()
export class RiotChampionSummaryService {
  private readonly logger = new Logger(RiotChampionSummaryService.name);
  private readonly minimumMeaningfulGames = 3;
  private readonly topChampionLimit = 3;
  private readonly rankedQueueCategories = ['RANKED_SOLO', 'RANKED_FLEX'];

  constructor(
    private readonly prismaService: PrismaService,
    private readonly riotMatchHistoryRepository: RiotMatchHistoryRepository,
  ) {}

  async getTopChampionsForUser(
    userId: string,
    preferredRiotAccountId?: string | null,
  ): Promise<TopChampionSummaryDto[]> {
    return (await this.getTopChampionSummaryForUser(userId, preferredRiotAccountId))
      .topChampions;
  }

  async getTopChampionSummaryForUser(
    userId: string,
    preferredRiotAccountId?: string | null,
  ): Promise<ChampionSummaryResult> {
    const account = await this.resolveAccount(userId, preferredRiotAccountId);

    if (!account?.puuid) {
      const aggregationStatus = this.buildEmptyStatus(
        'no_riot_account',
        'No Riot account is connected.',
        null,
        this.emptyDiagnostics(),
        null,
        false,
      );
      this.logChampionSummaryDebug(userId, 'empty_reason', {
        reason: aggregationStatus.reason,
      });
      return {
        topChampions: [],
        aggregationStatus,
      };
    }

    const diagnostics = await this.riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid(
      account.puuid,
    );
    this.logChampionSummaryDebug(userId, 'aggregation_input', {
      totalMatches: diagnostics.totalMatches,
      rankedMatches: diagnostics.rankedMatches,
      summaries: diagnostics.eligibleMatches,
      mappedMatches: diagnostics.mappedMatches,
      rankedMappedMatches: diagnostics.rankedMappedMatches,
    });

    if (diagnostics.totalMatches === 0) {
      const reason = this.resolveNoRowsReason(account);
      const aggregationStatus = this.buildEmptyStatus(
        reason,
        reason === 'no_sync'
          ? 'Champion history has not been populated for this Riot account yet.'
          : 'Champion history backfill is not deep enough yet.',
        account,
        diagnostics,
        null,
        false,
      );
      this.logChampionSummaryDebug(userId, 'empty_reason', {
        reason: aggregationStatus.reason,
      });
      return {
        topChampions: [],
        aggregationStatus,
      };
    }

    const useRankedOnly = diagnostics.rankedMatches > 0;
    const history = await this.riotMatchHistoryRepository.findChampionHistoryByPuuid(
      account.puuid,
      useRankedOnly ? this.rankedQueueCategories : undefined,
    );

    if (history.length === 0) {
      const reason =
        diagnostics.eligibleMatches === 0
          ? 'all_filtered'
          : this.shouldMarkInsufficientBackfill(account, diagnostics, useRankedOnly)
            ? 'insufficient_backfill'
            : 'insufficient_sample';
      const aggregationStatus = this.buildEmptyStatus(
        reason,
        reason === 'all_filtered'
          ? 'Stored matches were excluded by queue filtering.'
          : reason === 'insufficient_backfill'
            ? 'Stored matches exist, but participant summary coverage is still too shallow for top champion aggregation.'
            : 'Stored matches exist, but champion samples are still too sparse.',
        account,
        diagnostics,
        null,
        useRankedOnly,
      );
      this.logChampionSummaryDebug(userId, 'empty_reason', {
        reason: aggregationStatus.reason,
      });
      return {
        topChampions: [],
        aggregationStatus,
      };
    }

    const aggregation = this.buildTopChampions(history);
    for (const threshold of aggregation.fallbackThresholdsUsed) {
      this.logChampionSummaryDebug(userId, 'threshold_fallback', {
        threshold,
      });
    }

    if (aggregation.items.length === 0) {
      const reason =
        aggregation.mappingFailureCount > 0
          ? 'mapping_failure'
          : this.shouldMarkInsufficientBackfill(account, diagnostics, useRankedOnly)
            ? 'insufficient_backfill'
            : 'insufficient_sample';
      const aggregationStatus = this.buildEmptyStatus(
        reason,
        reason === 'mapping_failure'
          ? 'Stored matches could not be grouped by champion mapping.'
          : reason === 'insufficient_backfill'
            ? 'Champion participant summary coverage is still incomplete after threshold fallback.'
            : 'Champion samples are still too sparse after threshold fallback.',
        account,
        diagnostics,
        aggregation.thresholdUsed,
        useRankedOnly,
      );
      this.logChampionSummaryDebug(userId, 'empty_reason', {
        reason: aggregationStatus.reason,
      });
      return {
        topChampions: [],
        aggregationStatus,
      };
    }

    const aggregationStatus = this.buildReadyStatus(
      account,
      diagnostics,
      aggregation.thresholdUsed,
      useRankedOnly,
      aggregation.items.length,
    );
    this.logChampionSummaryDebug(userId, 'usable_content', {
      topChampionsCount: aggregation.items.length,
      status: aggregationStatus.status,
      reason: aggregationStatus.reason,
    });

    return {
      topChampions: aggregation.items,
      aggregationStatus,
    };
  }

  private async resolveAccount(
    userId: string,
    preferredRiotAccountId?: string | null,
  ): Promise<RiotAccountForChampionSummary | null> {
    if (preferredRiotAccountId) {
      const preferred = await this.prismaService.riotAccount.findFirst({
        where: {
          id: preferredRiotAccountId,
          userId,
        },
        select: {
          id: true,
          puuid: true,
          lastSyncedAt: true,
          processedMatchCount: true,
          queuedMatchCount: true,
          hasUsableSnapshot: true,
          matchHistoryNextStart: true,
          matchHistoryComplete: true,
        },
      });

      if (preferred?.puuid) {
        return this.normalizeAccountRecord(preferred);
      }
    }

    const account = await this.prismaService.riotAccount.findFirst({
      where: {
        userId,
      },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        puuid: true,
        lastSyncedAt: true,
        processedMatchCount: true,
        queuedMatchCount: true,
        hasUsableSnapshot: true,
        matchHistoryNextStart: true,
        matchHistoryComplete: true,
      },
    });

    return account ? this.normalizeAccountRecord(account) : null;
  }

  // Top 3 selection:
  // 1) total games desc
  // 2) latest season contribution desc
  // 3) win rate desc
  // Champions with 3+ games are prioritized, then smaller samples fill any remaining slots.
  private buildTopChampions(history: ChampionHistoryRow[]): ChampionAggregationDetail {
    const latestSeasonKey = this.resolveLatestSeasonKey(history);
    const buckets = new Map<string, ChampionBucket>();
    let mappingFailureCount = 0;

    for (const row of history) {
      const bucketKey = this.resolveBucketKey(row);
      if (!bucketKey) {
        mappingFailureCount += 1;
        continue;
      }
      const championId = row.championId ?? null;
      const championKey = this.resolveChampionKey(row) ?? String(championId ?? 'champion');
      const championName = this.resolveChampionName(row, championKey, championId);
      const current = buckets.get(bucketKey) ?? {
        championId,
        championKey,
        championName,
        games: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        lastPlayedAtMs: null,
        latestSeasonGames: 0,
      };

      current.games += 1;
      current.wins += row.didWin === true ? 1 : 0;
      current.losses += row.didWin === false ? 1 : 0;
      current.kills += row.kills;
      current.deaths += row.deaths;
      current.assists += row.assists;
      current.lastPlayedAtMs = Math.max(
        current.lastPlayedAtMs ?? 0,
        row.playedAt?.getTime() ?? 0,
      );

      if (row.seasonKey === latestSeasonKey) {
        current.latestSeasonGames += 1;
      }

      if (championId !== null && current.championId === null) {
        current.championId = championId;
      }
      if (!current.championKey && championKey) {
        current.championKey = championKey;
      }
      if (!current.championName && championName) {
        current.championName = championName;
      }

      buckets.set(bucketKey, current);
    }

    const ranked = [...buckets.values()].sort((left, right) =>
      this.compareBuckets(left, right),
    );
    const selected: ChampionBucket[] = [];
    const selectedKeys = new Set<string>();
    const fallbackThresholdsUsed: number[] = [];
    let thresholdUsed: number | null = null;

    for (const threshold of [this.minimumMeaningfulGames, 2, 1]) {
      const additions = ranked.filter((bucket) => {
        const key = this.bucketIdentity(bucket);
        return bucket.games >= threshold && !selectedKeys.has(key);
      });

      for (const bucket of additions) {
        if (selected.length >= this.topChampionLimit) {
          break;
        }

        selected.push(bucket);
        selectedKeys.add(this.bucketIdentity(bucket));
        thresholdUsed = thresholdUsed ?? threshold;
      }

      if (threshold < this.minimumMeaningfulGames && additions.length > 0) {
        fallbackThresholdsUsed.push(threshold);
      }

      if (selected.length >= this.topChampionLimit) {
        break;
      }
    }

    return {
      items: selected.map((bucket) => this.toDto(bucket)),
      thresholdUsed,
      fallbackThresholdsUsed,
      bucketCount: buckets.size,
      mappingFailureCount,
    };
  }

  private resolveLatestSeasonKey(history: ChampionHistoryRow[]): string {
    return history.reduce((latest, row) => {
      const seasonKey = row.seasonKey?.trim();
      if (!seasonKey) {
        return latest;
      }

      if (!latest) {
        return seasonKey;
      }

      const latestPlayedAt = history.find((candidate) => candidate.seasonKey === latest)?.playedAt;
      if (!latestPlayedAt) {
        return seasonKey;
      }

      return (row.playedAt?.getTime() ?? 0) > latestPlayedAt.getTime() ? seasonKey : latest;
    }, '');
  }

  private resolveBucketKey(row: ChampionHistoryRow): string | null {
    if (row.championId !== null) {
      return `id:${row.championId}`;
    }

    const championKey = this.resolveChampionKey(row);
    return championKey ? `key:${championKey}` : null;
  }

  private resolveChampionKey(row: ChampionHistoryRow): string | null {
    const raw = (row.championKey ?? row.championName ?? '').trim();
    if (raw.length > 0) {
      const normalized = raw.replace(/[^A-Za-z0-9]/g, '');
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (row.championId !== null) {
      return String(row.championId);
    }

    return null;
  }

  private resolveChampionName(
    row: ChampionHistoryRow,
    championKey: string,
    championId: number | null,
  ): string {
    const rawName = row.championName?.trim() ?? '';
    if (rawName.length > 0) {
      return rawName;
    }

    if (championKey && championKey.length > 0) {
      return championKey;
    }

    if (championId !== null) {
      return String(championId);
    }

    return 'champion';
  }

  private bucketIdentity(bucket: ChampionBucket): string {
    return bucket.championId !== null ? `id:${bucket.championId}` : `key:${bucket.championKey}`;
  }

  private compareBuckets(left: ChampionBucket, right: ChampionBucket): number {
    if (right.games !== left.games) {
      return right.games - left.games;
    }

    if (right.latestSeasonGames !== left.latestSeasonGames) {
      return right.latestSeasonGames - left.latestSeasonGames;
    }

    const winRateDiff = this.resolveWinRate(right) - this.resolveWinRate(left);
    if (winRateDiff !== 0) {
      return winRateDiff;
    }

    if ((right.lastPlayedAtMs ?? 0) !== (left.lastPlayedAtMs ?? 0)) {
      return (right.lastPlayedAtMs ?? 0) - (left.lastPlayedAtMs ?? 0);
    }

    return left.championKey.localeCompare(right.championKey, 'en');
  }

  private resolveWinRate(bucket: ChampionBucket): number {
    return bucket.games > 0 ? bucket.wins / bucket.games : 0;
  }

  private toDto(bucket: ChampionBucket): TopChampionSummaryDto {
    const winRate = this.resolveWinRate(bucket);
    const kda =
      bucket.games > 0
        ? Number(((bucket.kills + bucket.assists) / Math.max(bucket.deaths, 1)).toFixed(2))
        : null;

    return {
      championId: bucket.championId,
      championKey: bucket.championKey,
      championName: bucket.championName,
      games: bucket.games,
      wins: bucket.wins,
      losses: bucket.losses,
      winRate: Number(winRate.toFixed(4)),
      kills: bucket.kills,
      deaths: bucket.deaths,
      assists: bucket.assists,
      kda,
      lastPlayedAt:
        bucket.lastPlayedAtMs !== null
          ? new Date(bucket.lastPlayedAtMs).toISOString()
          : null,
    };
  }

  private buildReadyStatus(
    account: RiotAccountForChampionSummary,
    diagnostics: ChampionDiagnostics,
    thresholdUsed: number | null,
    useRankedOnly: boolean,
    topChampionsCount: number,
  ): TopChampionAggregationStatusDto {
    const needsBackfill = this.shouldMarkInsufficientBackfill(account, diagnostics, useRankedOnly);
    const insufficientSample = thresholdUsed !== null && thresholdUsed < this.minimumMeaningfulGames;
    const partial = needsBackfill || insufficientSample;
    const reason = needsBackfill
      ? 'insufficient_backfill'
      : insufficientSample
        ? 'insufficient_sample'
        : 'none';
    const scopeLabel = useRankedOnly ? 'ranked' : 'eligible';

    return {
      status: partial ? 'PARTIAL' : 'READY',
      reason,
      message: needsBackfill
        ? `Top champions were aggregated from the stored ${scopeLabel} history, but participant summary backfill is still incomplete.`
        : insufficientSample
          ? `Top champions were aggregated from stored ${scopeLabel} history, but the champion sample is still limited.`
          : `Top champions were aggregated from stored ${scopeLabel} history.`,
      hasUsableContent: topChampionsCount > 0,
      totalMatches: diagnostics.totalMatches,
      rankedMatches: diagnostics.rankedMatches,
      eligibleMatches: diagnostics.eligibleMatches,
      mappedMatches: diagnostics.mappedMatches,
      thresholdUsed,
      syncCoverageSummary: this.buildSyncCoverageSummary(
        account,
        diagnostics,
        useRankedOnly,
        topChampionsCount > 0,
      ),
    };
  }

  private buildEmptyStatus(
    reason: NonNullable<TopChampionAggregationStatusDto['reason']>,
    message: string,
    account: RiotAccountForChampionSummary | null,
    diagnostics: ChampionDiagnostics,
    thresholdUsed: number | null,
    useRankedOnly: boolean,
  ): TopChampionAggregationStatusDto {
    return {
      status: 'EMPTY',
      reason,
      message,
      hasUsableContent: false,
      totalMatches: diagnostics.totalMatches,
      rankedMatches: diagnostics.rankedMatches,
      eligibleMatches: diagnostics.eligibleMatches,
      mappedMatches: diagnostics.mappedMatches,
      thresholdUsed,
      syncCoverageSummary: this.buildSyncCoverageSummary(
        account,
        diagnostics,
        useRankedOnly,
        false,
      ),
    };
  }

  private resolveNoRowsReason(
    account: RiotAccountForChampionSummary,
  ): 'no_sync' | 'insufficient_backfill' {
    if (
      !account.lastSyncedAt ||
      (account.processedMatchCount === 0 &&
        account.queuedMatchCount === 0 &&
        account.matchHistoryNextStart === 0)
    ) {
      return 'no_sync';
    }

    return 'insufficient_backfill';
  }

  private emptyDiagnostics(): ChampionDiagnostics {
    return {
      totalMatches: 0,
      rankedMatches: 0,
      eligibleMatches: 0,
      ignoredMatches: 0,
      mappedMatches: 0,
      rankedMappedMatches: 0,
      eligibleMappedMatches: 0,
      mappingFailureMatches: 0,
      queueCounts: {},
    };
  }

  private buildSyncCoverageSummary(
    account: RiotAccountForChampionSummary | null,
    diagnostics: ChampionDiagnostics,
    useRankedOnly: boolean,
    hasUsableContent: boolean,
  ): Record<string, unknown> {
    const rankedMappedMatches = diagnostics.rankedMappedMatches ?? diagnostics.rankedMatches;
    const eligibleMappedMatches = diagnostics.eligibleMappedMatches ?? diagnostics.mappedMatches;
    const processed = account?.processedMatchCount ?? 0;
    const queued = account?.queuedMatchCount ?? 0;
    const coverageGap = Math.max(processed - diagnostics.totalMatches, 0);
    const coverageRatio =
      processed > 0 ? Number((diagnostics.totalMatches / processed).toFixed(4)) : null;
    const needsBackfill =
      account !== null
        ? this.shouldMarkInsufficientBackfill(account, diagnostics, useRankedOnly)
        : false;

    return {
      stored: diagnostics.totalMatches,
      rankedStored: diagnostics.rankedMatches,
      eligibleStored: diagnostics.eligibleMatches,
      mapped: diagnostics.mappedMatches,
      rankedMapped: rankedMappedMatches,
      eligibleMapped: eligibleMappedMatches,
      scopeStoredMatches: useRankedOnly ? diagnostics.rankedMatches : diagnostics.eligibleMatches,
      scopeMappedMatches: useRankedOnly
        ? rankedMappedMatches
        : eligibleMappedMatches,
      nextStart: account?.matchHistoryNextStart ?? null,
      complete: account?.matchHistoryComplete ?? false,
      processed,
      queued,
      hasUsableSnapshot: account?.hasUsableSnapshot ?? false,
      queueCounts: diagnostics.queueCounts,
      usedQueueScope: useRankedOnly ? 'ranked' : 'eligible',
      coverageGap,
      coverageRatio,
      needsBackfill,
      hasUsableContent,
      backfillSignal: needsBackfill ? 'REQUEST_SYNC_BACKFILL' : 'none',
    };
  }

  private shouldMarkInsufficientBackfill(
    account: RiotAccountForChampionSummary,
    diagnostics: ChampionDiagnostics,
    useRankedOnly: boolean,
  ): boolean {
    if (!account.matchHistoryComplete) {
      return true;
    }

    if (account.lastSyncedAt && diagnostics.totalMatches === 0) {
      return true;
    }

    const processed = account.processedMatchCount;
    if (processed >= 6 && diagnostics.totalMatches < Math.max(3, Math.floor(processed * 0.6))) {
      return true;
    }

    if (useRankedOnly && account.hasUsableSnapshot && diagnostics.rankedMatches === 0) {
      return true;
    }

    return false;
  }

  private normalizeAccountRecord(
    account: Partial<RiotAccountForChampionSummary> & Pick<RiotAccountForChampionSummary, 'id' | 'puuid'>,
  ): RiotAccountForChampionSummary {
    return {
      id: account.id,
      puuid: account.puuid,
      lastSyncedAt: account.lastSyncedAt ?? null,
      processedMatchCount: account.processedMatchCount ?? 0,
      queuedMatchCount: account.queuedMatchCount ?? 0,
      hasUsableSnapshot: account.hasUsableSnapshot ?? Boolean(account.lastSyncedAt),
      matchHistoryNextStart: account.matchHistoryNextStart ?? 0,
      matchHistoryComplete: account.matchHistoryComplete ?? true,
    };
  }

  private logChampionSummaryDebug(
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): void {
    const serialized = Object.entries(details)
      .map(([key, value]) => `${key}=${this.formatLogValue(value)}`)
      .join(' ');
    this.logger.debug(`[ChampionSummaryDebug] userId=${userId} action=${action} ${serialized}`);
  }

  private formatLogValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}
