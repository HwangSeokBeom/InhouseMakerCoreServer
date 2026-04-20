import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  QueueType,
  RiotSyncStatus,
  SnapshotType,
  VerificationStatus,
} from '@prisma/client';

import { AuditLogService } from '../common/audit-log.service';
import { toPrismaJson } from '../common/prisma-json.util';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateRiotAccountDto,
  RiotAccountDeleteResponseDto,
  RiotAccountListResponseDto,
  RiotAccountResponseDto,
  RiotAccountSyncAcceptedDto,
  RiotAccountSyncStatusResponseDto,
} from './dto/riot-account.dto';
import {
  RiotApiClient,
  RiotApiError,
  RiotSummonerResponse,
} from './riot-api.client';
import { RiotMatchHistoryRepository } from './riot-match-history.repository';
import { parseRiotIdentifier, resolveRiotRouting } from './riot-routing.util';

type MatchParticipant = Record<string, unknown>;
type MatchDetail = Record<string, unknown>;
type SyncPhase =
  | 'queued'
  | 'start'
  | 'summoner_lookup'
  | 'match_ids'
  | 'match_details'
  | 'ranked_lookup'
  | 'finalize'
  | 'failed';
type RankedEntry = {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

type RiotSyncWarning = {
  code: string;
  message: string;
  stage: 'league_lookup' | 'match_details';
  details?: Record<string, unknown>;
};

type RankedSyncResult = {
  entries: RankedEntry[] | null;
  rankedLookupRequestPuuid: string;
  resolvedSummonerId: string | null;
  resolvedSummonerIdSource:
    | 'summoner_lookup'
    | 'stored_account'
    | 'recent_match_participant'
    | 'none';
  warning: RiotSyncWarning | null;
};

type RiotAccountConflictCode = 'ALREADY_ADDED_BY_THIS_USER';
type RiotAccountDuplicateMatch = {
  id: string;
  userId: string;
  isPrimary: boolean;
  puuid: string;
};
type ChampionQueueCategory =
  | 'RANKED_SOLO'
  | 'RANKED_FLEX'
  | 'NORMAL'
  | 'CUSTOM'
  | 'IGNORED';
type MatchHistoryPageRequest = {
  start: number;
  count: number;
  kind: 'latest' | 'backfill';
};

@Injectable()
export class RiotService {
  private readonly logger = new Logger(RiotService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly riotApiClient: RiotApiClient,
    private readonly queueService: QueueService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    private readonly riotMatchHistoryRepository: RiotMatchHistoryRepository,
  ) {}

  async createForUser(
    userId: string,
    dto: CreateRiotAccountDto,
  ): Promise<RiotAccountResponseDto> {
    const normalized = this.normalizeCreateInput(dto);
    this.logAccountEvent('create_requested', {
      userId,
      riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
      region: normalized.platformRegion,
      requestedPrimary: dto.isPrimary ?? null,
    });
    this.logAccountEvent('duplicate_check_started', {
      userId,
      riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
      matchStrategy: 'riot_id_same_user',
    });
    const existingSameRiotId = await this.findListVisibleDuplicateByRiotId(
      userId,
      normalized.riotGameName,
      normalized.tagLine,
    );
    this.logDuplicateCheckResult('riot_id_same_user', existingSameRiotId);

    if (existingSameRiotId) {
      this.logAccountEvent('create_duplicate_same_user', {
        userId,
        riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
        region: normalized.platformRegion,
        conflictReason: 'ALREADY_ADDED_BY_THIS_USER',
        existingRiotAccountId: existingSameRiotId.id,
        matchedBy: 'riot_id_same_user',
        puuid: this.maskPuuid(existingSameRiotId.puuid),
      });
      throw this.buildSameUserConflictException('riot_id_same_user', existingSameRiotId.id);
    }

    const resolved = await this.riotApiClient
      .resolveAccountByRiotId(
        normalized.riotGameName,
        normalized.tagLine,
        normalized.accountRegion,
      )
      .catch((error) => {
        throw this.toHttpError(error);
      });

    this.logAccountEvent('duplicate_check_started', {
      userId,
      riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
      matchStrategy: 'puuid_same_user',
      puuid: this.maskPuuid(resolved.puuid),
    });
    const existingSamePuuid = await this.findListVisibleDuplicateByPuuid(
      userId,
      resolved.puuid,
    );
    this.logDuplicateCheckResult('puuid_same_user', existingSamePuuid);

    if (existingSamePuuid) {
      this.logAccountEvent('create_duplicate_same_user', {
        userId,
        riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
        region: normalized.platformRegion,
        conflictReason: 'ALREADY_ADDED_BY_THIS_USER',
        existingRiotAccountId: existingSamePuuid.id,
        matchedBy: 'puuid_same_user',
        puuid: this.maskPuuid(resolved.puuid),
      });
      throw this.buildSameUserConflictException('puuid_same_user', existingSamePuuid.id);
    }

    const existingPrimary = await this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        isPrimary: true,
      },
      select: { id: true },
    });
    const nextIsPrimary = dto.isPrimary ?? !existingPrimary;

    // Riot accounts remain hard-deleted. Delete + add recreates a fresh row instead of reviving.
    let created: Awaited<ReturnType<typeof this.prismaService.riotAccount.create>>;
    try {
      created = await this.prismaService.$transaction(async (tx) => {
        if (nextIsPrimary) {
          await tx.riotAccount.updateMany({
            where: { userId, isPrimary: true },
            data: { isPrimary: false },
          });
        }

        return tx.riotAccount.create({
          data: {
            userId,
            riotGameName: resolved.gameName,
            tagLine: resolved.tagLine,
            region: normalized.platformRegion,
            puuid: resolved.puuid,
            isPrimary: nextIsPrimary,
            verificationStatus: VerificationStatus.CLAIMED,
          },
        });
      });
    } catch (error) {
      if (this.isSameUserRiotAccountConflict(error)) {
        const concurrentDuplicate = await this.findListVisibleDuplicateByPuuid(
          userId,
          resolved.puuid,
        );
        this.logDuplicateCheckResult('puuid_same_user', concurrentDuplicate);

        if (!concurrentDuplicate) {
          throw error;
        }

        this.logAccountEvent('create_duplicate_same_user', {
          userId,
          riotId: `${normalized.riotGameName}#${normalized.tagLine}`,
          region: normalized.platformRegion,
          conflictReason: 'ALREADY_ADDED_BY_THIS_USER',
          existingRiotAccountId: concurrentDuplicate.id,
          matchedBy: 'puuid_same_user',
          puuid: this.maskPuuid(resolved.puuid),
        });
        throw this.buildSameUserConflictException('puuid_same_user', concurrentDuplicate.id);
      }
      throw error;
    }

    await this.queueSync(created.id, 'initial');
    if (created.isPrimary) {
      this.logAccountEvent('primary_updated', {
        userId,
        previousPrimaryRiotAccountId: existingPrimary?.id ?? null,
        nextPrimaryRiotAccountId: created.id,
        reason:
          dto.isPrimary === true
            ? 'create_requested_primary'
            : 'create_auto_primary',
      });
    }
    this.logAccountEvent('create_created', {
      userId,
      riotAccountId: created.id,
      riotId: `${created.riotGameName}#${created.tagLine}`,
      region: created.region,
      puuid: this.maskPuuid(created.puuid),
      isPrimary: created.isPrimary,
    });

    return this.getAccountResponse(created.id, userId);
  }

  async listForUser(userId: string): Promise<RiotAccountListResponseDto> {
    const items = await this.prismaService.riotAccount.findMany({
      where: this.buildListVisibleRiotAccountWhere(userId),
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    const hydratedItems = await Promise.all(
      items.map((item) => this.recoverStaleRunningSync(item)),
    );
    this.logAccountEvent('list_query_result_count', {
      userId,
      count: hydratedItems.length,
    });

    return {
      items: hydratedItems.map((item) => this.toResponse(item)),
    };
  }

  async enqueueSync(
    userId: string,
    riotAccountId: string,
  ): Promise<RiotAccountSyncAcceptedDto> {
    const account = await this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        id: riotAccountId,
      },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    const queued = await this.queueSync(riotAccountId, 'refresh');
    const current = await this.prismaService.riotAccount.findUniqueOrThrow({
      where: { id: riotAccountId },
    });

    return {
      riotAccountId,
      queued,
      syncStatus: current.syncStatus,
      lastSyncRequestedAt: current.lastSyncRequestedAt?.toISOString() ?? null,
    };
  }

  async getSyncStatus(
    userId: string,
    riotAccountId: string,
  ): Promise<RiotAccountSyncStatusResponseDto> {
    const account = await this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        id: riotAccountId,
      },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    return this.toSyncStatusResponse(await this.recoverStaleRunningSync(account));
  }

  async syncAccount(
    riotAccountId: string,
    requestedSyncType: 'initial' | 'refresh' = 'refresh',
    attemptsMade = 0,
    maxAttempts = 1,
  ): Promise<void> {
    const account = await this.prismaService.riotAccount.findUnique({
      where: { id: riotAccountId },
    });

    if (!account) {
      this.logger.warn(
        `Skipping Riot sync because account ${riotAccountId} no longer exists.`,
      );
      return;
    }

    const routing = this.resolveRoutingForStoredAccount(account.region);
    const syncType =
      requestedSyncType === 'initial' || account.lastSyncSucceededAt === null
        ? 'initial'
        : 'refresh';
    const startedAt = new Date();

    await this.prismaService.riotAccount.update({
      where: { id: riotAccountId },
      data: {
        syncStatus: RiotSyncStatus.RUNNING,
        syncPhase: 'start',
        lastSyncProgressAt: startedAt,
        lastSyncError: null,
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        lastSyncWarningCode: null,
        lastSyncWarningMessage: null,
        processedMatchCount: 0,
        queuedMatchCount: 0,
        hasUsableSnapshot: Boolean(account.lastSyncedAt),
      },
    });
    this.logSyncStateTransition(riotAccountId, account.syncStatus, RiotSyncStatus.RUNNING, {
      syncType,
    });
    this.logSyncDebug('start', {
      riotAccountId,
      syncType,
      matchHistoryNextStart: account.matchHistoryNextStart,
      matchHistoryComplete: account.matchHistoryComplete,
    });

    try {
      const warnings: RiotSyncWarning[] = [];

      await this.markSyncProgress({
        riotAccountId,
        phase: 'summoner_lookup',
      });
      this.logSyncStage('summoner_lookup_prepare', {
        riotAccountId,
        accountPuuid: account.puuid,
        platformRegion: routing.platformRegion,
      });
      const summoner = await this.riotApiClient.getSummonerByPuuid(
        account.puuid,
        routing.platformRegion,
      );
      this.logSyncStage('summoner_lookup_resolved', {
        riotAccountId,
        accountPuuid: account.puuid,
        summonerResponsePuuid: summoner.puuid,
        summonerEncryptedId: summoner.encryptedSummonerId,
        summonerEncryptedIdSourceField: summoner.encryptedSummonerIdSourceField,
        rawSummonerResponseKeys: Object.keys(summoner.rawResponse),
        profileIconId: summoner.profileIconId,
        summonerLevel: summoner.summonerLevel,
        summonerRevisionDate: summoner.revisionDate?.toISOString() ?? null,
      });

      this.logSyncStage('match_ids_lookup_prepare', {
        riotAccountId,
        accountPuuid: account.puuid,
        accountRegion: routing.accountRegion,
      });
      const matchHistorySync = await this.syncMatchHistory({
        userId: account.userId,
        riotAccountId,
        accountPuuid: account.puuid,
        matchHistoryNextStart: account.matchHistoryNextStart,
        matchHistoryComplete: account.matchHistoryComplete,
        accountRegion: routing.accountRegion,
        syncType,
      });
      this.logSyncStage('match_ids_lookup_resolved', {
        riotAccountId,
        accountPuuid: account.puuid,
        matchIdCount: matchHistorySync.recentMatchIds.length,
        backfillNextStart: matchHistorySync.cursorUpdate.matchHistoryNextStart,
        backfillComplete: matchHistorySync.cursorUpdate.matchHistoryComplete,
      });
      if (matchHistorySync.warning) {
        warnings.push(matchHistorySync.warning);
      }
      this.logMatchHistoryCoverage({
        userId: account.userId,
        stored: matchHistorySync.storedMatchCount,
        nextStart: matchHistorySync.cursorUpdate.matchHistoryNextStart,
        complete: matchHistorySync.cursorUpdate.matchHistoryComplete,
      });

      const resolvedSummonerId = this.resolveEncryptedSummonerId({
        accountPuuid: account.puuid,
        summoner,
        storedSummonerId: account.summonerId,
        recentMatches: matchHistorySync.recentMatches,
      });
      this.logSyncStage('ranked_lookup_input_resolved', {
        riotAccountId,
        accountPuuid: account.puuid,
        rankedLookupRequestPuuid: account.puuid,
        resolvedSummonerId: resolvedSummonerId.value,
        resolvedSummonerIdSource: resolvedSummonerId.source,
      });

      await this.markSyncProgress({
        riotAccountId,
        phase: 'ranked_lookup',
        processedMatchCount: matchHistorySync.processedMatchCount,
        queuedMatchCount: matchHistorySync.queuedMatchCount,
      });
      const rankedSync = await this.lookupRankedEntries({
        riotAccountId,
        accountPuuid: account.puuid,
        platformRegion: routing.platformRegion,
        resolvedSummonerId: resolvedSummonerId.value,
        resolvedSummonerIdSource: resolvedSummonerId.source,
      });
      if (rankedSync.warning) {
        warnings.push(rankedSync.warning);
      }

      const rankedSummary = rankedSync.entries
        ? this.buildRankedSummary(rankedSync.entries)
        : null;
      const recentSummary = this.buildRecentSummary(
        account.puuid,
        matchHistorySync.recentMatches,
        summoner,
      );
      const syncedAt = new Date();
      const primaryWarning = this.pickPrimaryWarning(warnings);
      const nextSyncStatus = primaryWarning
        ? RiotSyncStatus.PARTIAL
        : RiotSyncStatus.SUCCEEDED;
      const accountUpdateData = {
        summonerId: rankedSync.resolvedSummonerId ?? account.summonerId,
        profileIconId: summoner.profileIconId,
        summonerLevel: summoner.summonerLevel,
        summonerRevisionDate: summoner.revisionDate,
        syncStatus: nextSyncStatus,
        syncPhase: 'finalize' as SyncPhase,
        lastSyncedAt: syncedAt,
        lastSyncSucceededAt: syncedAt,
        lastSyncProgressAt: syncedAt,
        lastSyncError: null,
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        lastSyncWarningCode: primaryWarning?.code ?? null,
        lastSyncWarningMessage: primaryWarning?.message ?? null,
        processedMatchCount: matchHistorySync.processedMatchCount,
        queuedMatchCount: matchHistorySync.queuedMatchCount,
        hasUsableSnapshot: matchHistorySync.hasUsableSnapshot,
        matchHistoryNextStart: matchHistorySync.cursorUpdate.matchHistoryNextStart,
        matchHistoryComplete: matchHistorySync.cursorUpdate.matchHistoryComplete,
      };
      const transactionOperations = [
        this.prismaService.riotAccount.update({
          where: { id: riotAccountId },
          data: accountUpdateData,
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
      ];

      if (rankedSummary && rankedSync.entries) {
        transactionOperations.push(
          this.prismaService.riotAccountSnapshot.create({
            data: {
              riotAccountId,
              snapshotType: SnapshotType.RANKED,
              queueType: QueueType.ALL,
              sampleSize: rankedSync.entries.length,
              tier: rankedSummary.primaryTier,
              rank: rankedSummary.primaryRank,
              lp: rankedSummary.primaryLp,
              metricsJson: toPrismaJson(rankedSummary),
            },
          }),
        );
      }

      await this.prismaService.$transaction(transactionOperations);
      this.logSyncStateTransition(riotAccountId, RiotSyncStatus.RUNNING, nextSyncStatus, {
        syncType,
        warningCode: primaryWarning?.code ?? null,
      });
      this.logSyncDebug('finalize_success', {
        riotAccountId,
        syncType,
        syncStatus: nextSyncStatus,
        usableSnapshot: matchHistorySync.hasUsableSnapshot,
        processedMatchCount: matchHistorySync.processedMatchCount,
        queuedMatchCount: matchHistorySync.queuedMatchCount,
        matchHistoryNextStart: matchHistorySync.cursorUpdate.matchHistoryNextStart,
        matchHistoryComplete: matchHistorySync.cursorUpdate.matchHistoryComplete,
        warningCode: primaryWarning?.code ?? null,
      });
      this.logSyncStage('sync_finalize', {
        riotAccountId,
        syncStatus: nextSyncStatus,
        accountPuuid: account.puuid,
        summonerEncryptedId: accountUpdateData.summonerId ?? null,
        rankedLookupRequestPuuid: rankedSync.rankedLookupRequestPuuid,
        resolvedSummonerIdSource: rankedSync.resolvedSummonerIdSource,
        warningCode: primaryWarning?.code ?? null,
        warningMessage: primaryWarning?.message ?? null,
        rankedSnapshotSaved: Boolean(rankedSummary),
        rankedEntryCount: rankedSync.entries?.length ?? 0,
      });

      await this.auditLogService.create({
        userId: account.userId,
        action:
          nextSyncStatus === RiotSyncStatus.PARTIAL
            ? 'RIOT_SYNC_PARTIAL'
            : 'RIOT_SYNC_SUCCEEDED',
        entityType: 'riot_accounts',
        entityId: riotAccountId,
        meta: {
          syncStatus: nextSyncStatus,
          attemptsMade,
          warningCode: primaryWarning?.code ?? null,
          warningMessage: primaryWarning?.message ?? null,
          rankedLookupRequestPuuid: rankedSync.rankedLookupRequestPuuid,
          resolvedSummonerId: rankedSync.resolvedSummonerId,
          resolvedSummonerIdSource: rankedSync.resolvedSummonerIdSource,
        },
      });

      await this.queueService.enqueuePowerRecalculation(account.userId, 'riot-sync');
      this.logAccountEvent('sync_completed', {
        userId: account.userId,
        riotAccountId,
        riotId: `${account.riotGameName}#${account.tagLine}`,
        syncStatus: nextSyncStatus,
        result: 'success',
        warningCode: primaryWarning?.code ?? null,
        puuid: this.maskPuuid(account.puuid),
      });
    } catch (error) {
      const syncError = this.toSyncFailure(error, attemptsMade, maxAttempts);
      this.logSyncFailure(
        riotAccountId,
        account.puuid,
        syncError.code,
        syncError.message,
        syncError.nextStatus,
      );

      await this.prismaService.riotAccount.update({
        where: { id: riotAccountId },
        data: {
          syncStatus: syncError.nextStatus,
          syncPhase: 'failed',
          lastSyncFailedAt: syncError.failedAt,
          lastSyncProgressAt: syncError.failedAt,
          lastSyncError: syncError.message,
          lastSyncErrorCode: syncError.code,
          lastSyncErrorMessage: syncError.message,
          lastSyncWarningCode: null,
          lastSyncWarningMessage: null,
          hasUsableSnapshot: Boolean(account.lastSyncedAt),
        },
      });
      this.logSyncStateTransition(riotAccountId, RiotSyncStatus.RUNNING, syncError.nextStatus, {
        syncType,
        errorCode: syncError.code,
      });
      this.logSyncDebug('finalize_failure', {
        riotAccountId,
        syncType,
        code: syncError.code,
        message: syncError.message,
        nextStatus: syncError.nextStatus,
      });

      await this.auditLogService.create({
        userId: account.userId,
        action: 'RIOT_SYNC_FAILED',
        entityType: 'riot_accounts',
        entityId: riotAccountId,
        meta: {
          syncStatus: syncError.nextStatus,
          errorCode: syncError.code,
          errorMessage: syncError.message,
          attemptsMade,
          maxAttempts,
        },
      });
      this.logAccountEvent('sync_completed', {
        userId: account.userId,
        riotAccountId,
        riotId: `${account.riotGameName}#${account.tagLine}`,
        syncStatus: syncError.nextStatus,
        result: 'failed',
        errorCode: syncError.code,
        puuid: this.maskPuuid(account.puuid),
      });

      if (syncError.shouldRetry) {
        throw error;
      }
    }
  }

  async deleteForUser(
    userId: string,
    riotAccountId: string,
  ): Promise<RiotAccountDeleteResponseDto> {
    const account = await this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        id: riotAccountId,
      },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    this.logAccountEvent('delete_requested', {
      userId,
      riotAccountId,
      riotId: `${account.riotGameName}#${account.tagLine}`,
      region: account.region,
      isPrimary: account.isPrimary,
      puuid: this.maskPuuid(account.puuid),
    });

    const removedQueuedSyncJobs = await this.queueService.cancelRiotSyncJobs(riotAccountId);

    const result = await this.prismaService.$transaction(async (tx) => {
      await tx.riotAccount.delete({
        where: { id: riotAccountId },
      });

      let nextPrimaryRiotAccountId: string | null = null;
      if (account.isPrimary) {
        const nextPrimary = await tx.riotAccount.findFirst({
          where: this.buildListVisibleRiotAccountWhere(userId),
          orderBy: [{ createdAt: 'asc' }],
        });

        if (nextPrimary) {
          await tx.riotAccount.update({
            where: { id: nextPrimary.id },
            data: { isPrimary: true },
          });
          nextPrimaryRiotAccountId = nextPrimary.id;
        }
      }

      const remainingAccounts = await tx.riotAccount.findMany({
        where: this.buildListVisibleRiotAccountWhere(userId),
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      return {
        nextPrimaryRiotAccountId,
        remainingAccounts,
      };
    });

    await this.auditLogService.create({
      userId,
      action: 'RIOT_ACCOUNT_DELETED',
      entityType: 'riot_accounts',
      entityId: riotAccountId,
      meta: {
        deletedWasPrimary: account.isPrimary,
        nextPrimaryRiotAccountId: result.nextPrimaryRiotAccountId,
        removedQueuedSyncJobs,
      },
    });

    await this.queueService.enqueuePowerRecalculation(userId, 'riot-account-delete');
    if (result.nextPrimaryRiotAccountId) {
      this.logAccountEvent('primary_updated', {
        userId,
        previousPrimaryRiotAccountId: riotAccountId,
        nextPrimaryRiotAccountId: result.nextPrimaryRiotAccountId,
        reason: 'delete_promote_oldest_remaining',
      });
    }
    this.logAccountEvent('delete_completed', {
      userId,
      riotAccountId,
      deletedWasPrimary: account.isPrimary,
      nextPrimaryRiotAccountId: result.nextPrimaryRiotAccountId,
      remainingAccountCount: result.remainingAccounts.length,
      removedQueuedSyncJobs,
    });

    return {
      deletedRiotAccountId: riotAccountId,
      deletedWasPrimary: account.isPrimary,
      nextPrimaryRiotAccountId: result.nextPrimaryRiotAccountId,
      removedQueuedSyncJobs,
      items: result.remainingAccounts.map((item) => this.toResponse(item)),
    };
  }

  private async getAccountResponse(
    riotAccountId: string,
    userId: string,
  ): Promise<RiotAccountResponseDto> {
    const account = await this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        id: riotAccountId,
      },
    });

    if (!account) {
      throw new NotFoundException('Riot account not found.');
    }

    return this.toResponse(await this.recoverStaleRunningSync(account));
  }

  private async queueSync(
    riotAccountId: string,
    type: 'initial' | 'refresh',
  ): Promise<boolean> {
    const currentAccount = await this.prismaService.riotAccount.findUnique({
      where: { id: riotAccountId },
    });

    if (!currentAccount) {
      throw new NotFoundException('Riot account not found.');
    }
    const account = await this.recoverStaleRunningSync(currentAccount);

    this.logAccountEvent('sync_requested', {
      userId: account.userId,
      riotAccountId,
      riotId: `${account.riotGameName}#${account.tagLine}`,
      syncType: type,
      currentSyncStatus: account.syncStatus,
      puuid: this.maskPuuid(account.puuid),
    });

    if (
      account.syncStatus === RiotSyncStatus.QUEUED ||
      account.syncStatus === RiotSyncStatus.RUNNING ||
      account.syncStatus === RiotSyncStatus.RETRY_SCHEDULED
    ) {
      return false;
    }

    await this.prismaService.riotAccount.update({
      where: { id: riotAccountId },
      data: {
        syncStatus: RiotSyncStatus.QUEUED,
        syncPhase: 'queued',
        lastSyncRequestedAt: new Date(),
        lastSyncProgressAt: new Date(),
        lastSyncError: null,
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        lastSyncWarningCode: null,
        lastSyncWarningMessage: null,
        processedMatchCount: 0,
        queuedMatchCount: 0,
        hasUsableSnapshot: Boolean(account.lastSyncedAt),
      },
    });
    this.logSyncStateTransition(riotAccountId, account.syncStatus, RiotSyncStatus.QUEUED, {
      syncType: type,
    });

    try {
      if (type === 'initial') {
        await this.queueService.enqueueRiotAccountInitialSync(riotAccountId);
      } else {
        await this.queueService.enqueueRiotAccountRefresh(riotAccountId);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Queue enqueue failed.';

      await this.prismaService.riotAccount.update({
        where: { id: riotAccountId },
        data: {
          syncStatus: RiotSyncStatus.FAILED,
          syncPhase: 'failed',
          lastSyncFailedAt: new Date(),
          lastSyncProgressAt: new Date(),
          lastSyncError: message,
          lastSyncErrorCode: 'QUEUE_ENQUEUE_FAILED',
          lastSyncErrorMessage: message,
          lastSyncWarningCode: null,
          lastSyncWarningMessage: null,
        },
      });
      this.logSyncStateTransition(riotAccountId, RiotSyncStatus.QUEUED, RiotSyncStatus.FAILED, {
        syncType: type,
        reason: 'queue_enqueue_failed',
      });

      throw new ServiceUnavailableException('Unable to enqueue Riot sync job.');
    }
  }

  private toSyncFailure(error: unknown, attemptsMade: number, maxAttempts: number) {
    const failedAt = new Date();
    const riotError =
      error instanceof RiotApiError
        ? error
        : new RiotApiError(
            error instanceof Error ? error.message : 'Unknown sync error',
            'RIOT_SYNC_UNKNOWN_ERROR',
            HttpStatus.SERVICE_UNAVAILABLE,
            true,
          );
    const shouldRetry = riotError.retryable && attemptsMade + 1 < maxAttempts;

    return {
      failedAt,
      code: riotError.code,
      message: riotError.message,
      nextStatus: shouldRetry ? RiotSyncStatus.RETRY_SCHEDULED : RiotSyncStatus.FAILED,
      shouldRetry,
    };
  }

  private toHttpError(error: unknown): Error {
    if (error instanceof RiotApiError) {
      if (error.code === 'RIOT_RESOURCE_NOT_FOUND') {
        return new NotFoundException('Riot account could not be resolved.');
      }

      return new HttpException(error.message, error.status);
    }

    return new ServiceUnavailableException('Riot API request failed.');
  }

  private normalizeCreateInput(dto: CreateRiotAccountDto) {
    const identifier = parseRiotIdentifier({
      riotGameName: dto.riotGameName,
      tagLine: dto.tagLine,
    });
    const routing = resolveRiotRouting(
      dto.region,
      this.configService.getOrThrow<string>('RIOT_PLATFORM_REGION'),
    );

    return {
      riotGameName: identifier.riotGameName,
      tagLine: identifier.tagLine,
      platformRegion: routing.platformRegion,
      accountRegion: routing.accountRegion,
    };
  }

  private resolveRoutingForStoredAccount(region: string) {
    return resolveRiotRouting(
      region,
      this.configService.getOrThrow<string>('RIOT_PLATFORM_REGION'),
    );
  }

  private async lookupRankedEntries(input: {
    riotAccountId: string;
    accountPuuid: string;
    platformRegion: string;
    resolvedSummonerId: string | null;
    resolvedSummonerIdSource:
      | 'summoner_lookup'
      | 'stored_account'
      | 'recent_match_participant'
      | 'none';
  }): Promise<RankedSyncResult> {
    const {
      riotAccountId,
      accountPuuid,
      platformRegion,
      resolvedSummonerId,
      resolvedSummonerIdSource,
    } = input;

    this.logSyncStage('league_lookup_prepare', {
      riotAccountId,
      accountPuuid,
      leagueLookupRequestPuuid: accountPuuid,
      resolvedSummonerId,
      resolvedSummonerIdSource,
      platformRegion,
    });

    try {
      const entries = await this.riotApiClient.getRankedEntriesByPuuid(
        accountPuuid,
        platformRegion,
      );
      this.logSyncStage('league_lookup_resolved', {
        riotAccountId,
        leagueLookupRequestPuuid: accountPuuid,
        resolvedSummonerId,
        resolvedSummonerIdSource,
        entryCount: entries.length,
      });

      return {
        entries,
        rankedLookupRequestPuuid: accountPuuid,
        resolvedSummonerId,
        resolvedSummonerIdSource,
        warning: null,
      };
    } catch (error) {
      if (!(error instanceof RiotApiError)) {
        throw error;
      }

      const warning = this.buildRankWarning(
        'RIOT_RANK_SYNC_UNAVAILABLE',
        'Ranked data could not be refreshed from Riot right now.',
        {
          riotAccountId,
          leagueLookupRequestPuuid: accountPuuid,
          resolvedSummonerId,
          resolvedSummonerIdSource,
          riotErrorCode: error.code,
          riotErrorMessage: error.message,
        },
      );

      this.logger.warn(
        `[riot_sync] ranked_lookup_unavailable ${JSON.stringify(
          this.sanitizeLogDetails({
            riotAccountId,
            accountPuuid,
            leagueLookupRequestPuuid: accountPuuid,
            resolvedSummonerId,
            resolvedSummonerIdSource,
            riotErrorCode: error.code,
            riotErrorMessage: error.message,
          }),
        )}`,
      );

      return {
        entries: null,
        rankedLookupRequestPuuid: accountPuuid,
        resolvedSummonerId,
        resolvedSummonerIdSource,
        warning,
      };
    }
  }

  private resolveEncryptedSummonerId(input: {
    accountPuuid: string;
    summoner: RiotSummonerResponse;
    storedSummonerId: string | null;
    recentMatches: Record<string, unknown>[];
  }): {
    value: string | null;
    source:
      | 'summoner_lookup'
      | 'stored_account'
      | 'recent_match_participant'
      | 'none';
  } {
    if (input.summoner.puuid !== input.accountPuuid) {
      this.logger.warn(
        `[riot_sync] summoner_lookup_puuid_mismatch ${JSON.stringify(
          this.sanitizeLogDetails({
            accountPuuid: input.accountPuuid,
            summonerResponsePuuid: input.summoner.puuid,
          }),
        )}`,
      );
    }

    if (input.summoner.encryptedSummonerId) {
      return {
        value: input.summoner.encryptedSummonerId,
        source: 'summoner_lookup',
      };
    }

    const recentMatchSummonerId = this.extractSummonerIdFromMatches(
      input.accountPuuid,
      input.recentMatches,
    );
    if (recentMatchSummonerId) {
      return {
        value: recentMatchSummonerId,
        source: 'recent_match_participant',
      };
    }

    if (input.storedSummonerId) {
      return {
        value: input.storedSummonerId,
        source: 'stored_account',
      };
    }

    return {
      value: null,
      source: 'none',
    };
  }

  private extractSummonerIdFromMatches(
    puuid: string,
    matchDetails: Record<string, unknown>[],
  ): string | null {
    for (const detail of matchDetails) {
      const participants =
        ((detail.info as { participants?: MatchParticipant[] } | undefined)?.participants ??
          []) as MatchParticipant[];
      const participant = participants.find((candidate) => candidate.puuid === puuid);
      const summonerId =
        typeof participant?.summonerId === 'string' && participant.summonerId.trim().length > 0
          ? participant.summonerId
          : null;

      if (summonerId) {
        return summonerId;
      }
    }

    return null;
  }

  private async syncMatchHistory(input: {
    userId: string;
    riotAccountId: string;
    accountPuuid: string;
    matchHistoryNextStart: number;
    matchHistoryComplete: boolean;
    accountRegion: string;
    syncType: 'initial' | 'refresh';
  }): Promise<{
    recentMatchIds: string[];
    recentMatches: MatchDetail[];
    processedMatchCount: number;
    queuedMatchCount: number;
    hasUsableSnapshot: boolean;
    storedMatchCount: number;
    warning: RiotSyncWarning | null;
    cursorUpdate: {
      matchHistoryNextStart: number;
      matchHistoryComplete: boolean;
    };
  }> {
    const pageSize = this.configService.get<number>('RIOT_MATCH_HISTORY_PAGE_SIZE', 100);
    const initialSyncMatchCount = this.configService.get<number>(
      'RIOT_INITIAL_SYNC_MATCH_COUNT',
      25,
    );
    const extraPages =
      input.syncType === 'initial'
        ? 0
        : this.configService.get<number>(
            'RIOT_MATCH_HISTORY_EXTRA_PAGES_PER_SYNC',
            1,
          );
    const latestPageSize = input.syncType === 'initial' ? initialSyncMatchCount : pageSize;
    const pageRequests = this.buildMatchHistoryPageRequests({
      currentNextStart: input.matchHistoryNextStart,
      currentComplete: input.matchHistoryComplete,
      latestPageSize,
      backfillPageSize: pageSize,
      extraPages,
    });
    const pageResults = new Map<number, string[]>();

    await this.markSyncProgress({
      riotAccountId: input.riotAccountId,
      phase: 'match_ids',
    });

    for (const request of pageRequests) {
      const ids = await this.riotApiClient.getRecentMatchIds(
        input.accountPuuid,
        request.count,
        request.start,
        input.accountRegion,
      );
      pageResults.set(request.start, ids);
      this.logSyncDebug('match_ids_loaded', {
        riotAccountId: input.riotAccountId,
        phase: 'match_ids',
        pageKind: request.kind,
        start: request.start,
        count: ids.length,
        requestedCount: request.count,
        nextStartCandidate: request.start + ids.length,
      });
    }

    const recentMatchIds = pageResults.get(0) ?? [];
    const recentSummaryTargetCount =
      input.syncType === 'initial' ? recentMatchIds.length : Math.min(10, recentMatchIds.length);
    const recentSummaryMatchIds = recentMatchIds.slice(0, recentSummaryTargetCount);
    const allMatchIds = [...new Set([...pageResults.values()].flat())];
    const knownMatchIds = await this.riotMatchHistoryRepository.findKnownMatchIds(
      input.accountPuuid,
      allMatchIds,
    );
    const priorityMatchIds = [...new Set(recentSummaryMatchIds)];
    const priorityMatchIdSet = new Set(priorityMatchIds);
    const backgroundMatchIds = allMatchIds.filter(
      (matchId) => !priorityMatchIdSet.has(matchId) && !knownMatchIds.has(matchId),
    );
    const queuedMatchCount = priorityMatchIds.length + backgroundMatchIds.length;
    const progress = {
      processedMatchCount: 0,
      queuedMatchCount,
    };

    await this.markSyncProgress({
      riotAccountId: input.riotAccountId,
      phase: 'match_details',
      processedMatchCount: progress.processedMatchCount,
      queuedMatchCount: progress.queuedMatchCount,
    });

    const priorityDetails = await this.fetchMatchDetailsWithProgress({
      riotAccountId: input.riotAccountId,
      matchIds: priorityMatchIds,
      accountRegion: input.accountRegion,
      progress,
      batchLabel: 'priority_recent',
    });
    const backgroundDetails = await this.fetchMatchDetailsWithProgress({
      riotAccountId: input.riotAccountId,
      matchIds: backgroundMatchIds,
      accountRegion: input.accountRegion,
      progress,
      batchLabel: 'history_backfill',
    });
    const detailMap = new Map<string, MatchDetail>([
      ...priorityDetails.details.entries(),
      ...backgroundDetails.details.entries(),
    ]);
    const recentMatches = recentSummaryMatchIds.flatMap((matchId) => {
      const detail = detailMap.get(matchId);
      return detail ? [detail] : [];
    });
    const minimumUsableMatches = this.calculateMinimumUsableMatches(recentSummaryMatchIds.length);
    const hasUsableSnapshot =
      recentSummaryMatchIds.length === 0 || recentMatches.length >= minimumUsableMatches;

    if (!hasUsableSnapshot) {
      throw new RiotApiError(
        'Riot recent match details could not be loaded enough to build a usable snapshot.',
        'RIOT_MATCH_DETAIL_INCOMPLETE',
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );
    }

    const persistResult = await this.persistMatchHistory({
      puuid: input.accountPuuid,
      allMatchIds,
      knownMatchIds,
      detailMap,
    });
    const resolvedMatchIds = new Set<string>([
      ...knownMatchIds,
      ...detailMap.keys(),
    ]);
    const failedMatchCount =
      priorityDetails.failedMatchIds.length + backgroundDetails.failedMatchIds.length;
    const warning =
      failedMatchCount > 0
        ? this.buildMatchDetailWarning(
            'RIOT_MATCH_DETAIL_PARTIAL',
            'Some Riot match details could not be loaded during sync.',
            {
              riotAccountId: input.riotAccountId,
              syncType: input.syncType,
              failedMatchCount,
              recentRequestedCount: recentSummaryMatchIds.length,
              recentResolvedCount: recentMatches.length,
              storedMatchCount: persistResult.storedMatchCount,
            },
          )
        : null;
    this.logSyncDebug('progress', {
      riotAccountId: input.riotAccountId,
      phase: 'match_details',
      processedMatches: progress.processedMatchCount,
      queuedMatches: progress.queuedMatchCount,
      storedMatches: persistResult.storedMatchCount,
      unresolvedMatches: persistResult.unresolvedMatchIds.length,
      nextStart: input.matchHistoryNextStart,
    });

    return {
      recentMatchIds,
      recentMatches,
      processedMatchCount: progress.processedMatchCount,
      queuedMatchCount: progress.queuedMatchCount,
      hasUsableSnapshot,
      storedMatchCount: persistResult.storedMatchCount,
      warning,
      cursorUpdate: this.advanceMatchHistoryCursor({
        currentNextStart: input.matchHistoryNextStart,
        currentComplete: input.matchHistoryComplete,
        pageRequests,
        pageResults,
        resolvedMatchIds,
      }),
    };
  }

  private buildMatchHistoryPageRequests(
    args: {
      currentNextStart: number;
      currentComplete: boolean;
      latestPageSize: number;
      backfillPageSize: number;
      extraPages: number;
    },
  ): MatchHistoryPageRequest[] {
    const requests = new Map<number, MatchHistoryPageRequest>();
    requests.set(0, {
      start: 0,
      count: args.latestPageSize,
      kind: 'latest',
    });

    if (args.currentComplete) {
      return [...requests.values()];
    }

    let cursor = args.currentNextStart === 0 ? args.latestPageSize : args.currentNextStart;
    for (let index = 0; index < args.extraPages; index += 1) {
      requests.set(cursor, {
        start: cursor,
        count: args.backfillPageSize,
        kind: 'backfill',
      });
      cursor += args.backfillPageSize;
    }

    return [...requests.values()].sort((left, right) => left.start - right.start);
  }

  private async fetchMatchDetailsWithProgress(input: {
    riotAccountId: string;
    matchIds: string[];
    accountRegion: string;
    progress: {
      processedMatchCount: number;
      queuedMatchCount: number;
    };
    batchLabel: 'priority_recent' | 'history_backfill';
  }): Promise<{
    details: Map<string, MatchDetail>;
    failedMatchIds: string[];
  }> {
    if (input.matchIds.length === 0) {
      return {
        details: new Map<string, MatchDetail>(),
        failedMatchIds: [],
      };
    }

    const batchSize = this.configService.get<number>('RIOT_MATCH_DETAIL_BATCH_SIZE', 10);
    const details = new Map<string, MatchDetail>();
    const failedMatchIds: string[] = [];

    for (const chunk of this.chunk(input.matchIds, batchSize)) {
      this.logSyncDebug('detail_batch_started', {
        riotAccountId: input.riotAccountId,
        phase: 'match_details',
        batchLabel: input.batchLabel,
        batchSize: chunk.length,
        concurrency: batchSize,
      });
      const results = await Promise.allSettled(
        chunk.map((matchId) => this.riotApiClient.getMatchDetail(matchId, input.accountRegion)),
      );
      let batchSuccess = 0;
      let batchFailed = 0;

      results.forEach((result, index) => {
        const matchId = chunk[index];
        if (result.status === 'fulfilled') {
          details.set(matchId, result.value);
          batchSuccess += 1;
          return;
        }

        failedMatchIds.push(matchId);
        batchFailed += 1;
        const reason =
          result.reason instanceof Error ? result.reason.message : 'unknown_match_detail_error';
        this.logger.warn(
          `[riot_sync] champion_history_match_detail_skipped ${JSON.stringify(
            this.sanitizeLogDetails({
              matchId,
              accountRegion: input.accountRegion,
              reason,
            }),
          )}`,
        );
      });

      input.progress.processedMatchCount += chunk.length;
      await this.markSyncProgress({
        riotAccountId: input.riotAccountId,
        phase: 'match_details',
        processedMatchCount: input.progress.processedMatchCount,
        queuedMatchCount: input.progress.queuedMatchCount,
      });
      this.logSyncDebug('detail_batch_completed', {
        riotAccountId: input.riotAccountId,
        phase: 'match_details',
        batchLabel: input.batchLabel,
        batchSize: chunk.length,
        success: batchSuccess,
        failed: batchFailed,
      });
    }

    return {
      details,
      failedMatchIds,
    };
  }

  private async persistMatchHistory(input: {
    puuid: string;
    allMatchIds: string[];
    knownMatchIds: Set<string>;
    detailMap: Map<string, MatchDetail>;
  }): Promise<{
    storedMatchCount: number;
    unresolvedMatchIds: string[];
  }> {
    if (input.allMatchIds.length === 0) {
      return {
        storedMatchCount: 0,
        unresolvedMatchIds: [],
      };
    }

    const unresolvedMatchIds = input.allMatchIds.filter(
      (matchId) => !input.knownMatchIds.has(matchId) && !input.detailMap.has(matchId),
    );
    const rows = input.allMatchIds
      .filter((matchId) => !input.knownMatchIds.has(matchId))
      .map((matchId) => {
        const detail = input.detailMap.get(matchId);
        if (!detail) {
          return null;
        }

        return this.toParticipantSummaryRow(matchId, input.puuid, detail);
      })
      .filter(
        (
          row,
        ): row is Prisma.RiotMatchParticipantSummaryCreateManyInput => row !== null,
      );

    await this.riotMatchHistoryRepository.createParticipantSummaries(rows);
    return {
      storedMatchCount: rows.length,
      unresolvedMatchIds,
    };
  }

  private toParticipantSummaryRow(
    matchId: string,
    puuid: string,
    detail: MatchDetail,
  ): Prisma.RiotMatchParticipantSummaryCreateManyInput | null {
    const info = (detail.info as Record<string, unknown> | undefined) ?? {};
    const participants = Array.isArray(info.participants)
      ? (info.participants as MatchParticipant[])
      : [];
    const participant = participants.find((candidate) => candidate.puuid === puuid) ?? null;
    const queueId = this.readNullableNumber(info.queueId);
    const gameMode = this.readNullableString(info.gameMode);
    const gameType = this.readNullableString(info.gameType);
    const mapId = this.readNullableNumber(info.mapId);
    const playedAt = this.resolveMatchPlayedAt(info);
    const queueCategory = participant
      ? this.resolveChampionQueueCategory({ queueId, gameMode, gameType, mapId })
      : 'IGNORED';
    const championId = this.readNullableNumber(participant?.championId);
    const championKey = this.normalizeChampionKey(
      this.readNullableString(participant?.championName),
      championId,
    );
    const championName = this.resolveChampionName(
      this.readNullableString(participant?.championName),
      championKey,
      championId,
    );

    return {
      riotMatchId: matchId,
      puuid,
      queueId,
      queueCategory,
      gameMode,
      gameType,
      mapId,
      playedAt,
      seasonKey: this.resolveSeasonKey(playedAt),
      championId,
      championKey,
      championName,
      kills: this.readNullableNumber(participant?.kills) ?? 0,
      deaths: this.readNullableNumber(participant?.deaths) ?? 0,
      assists: this.readNullableNumber(participant?.assists) ?? 0,
      didWin: this.readNullableBoolean(participant?.win),
    };
  }

  private resolveChampionQueueCategory(input: {
    queueId: number | null;
    gameMode: string | null;
    gameType: string | null;
    mapId: number | null;
  }): ChampionQueueCategory {
    if (input.queueId === 420) {
      return 'RANKED_SOLO';
    }

    if (input.queueId === 440) {
      return 'RANKED_FLEX';
    }

    if ([400, 430, 490].includes(input.queueId ?? -1)) {
      return 'NORMAL';
    }

    const isSummonersRiftClassic =
      input.mapId === 11 && input.gameMode?.toUpperCase() === 'CLASSIC';
    if (isSummonersRiftClassic && input.gameType?.toUpperCase() === 'CUSTOM_GAME') {
      return 'CUSTOM';
    }

    return 'IGNORED';
  }

  private normalizeChampionKey(
    rawChampionName: string | null,
    championId: number | null,
  ): string | null {
    const normalized = rawChampionName?.replace(/[^A-Za-z0-9]/g, '').trim() ?? '';
    if (normalized.length > 0) {
      return normalized;
    }

    if (championId !== null) {
      return String(championId);
    }

    return null;
  }

  private resolveChampionName(
    rawChampionName: string | null,
    championKey: string | null,
    championId: number | null,
  ): string | null {
    if (rawChampionName?.trim()) {
      return rawChampionName.trim();
    }

    if (championKey?.trim()) {
      return championKey.trim();
    }

    if (championId !== null) {
      return String(championId);
    }

    return null;
  }

  private resolveMatchPlayedAt(info: Record<string, unknown>): Date {
    const timestamps = [
      this.readNullableNumber(info.gameEndTimestamp),
      this.readNullableNumber(info.gameStartTimestamp),
      this.readNullableNumber(info.gameCreation),
    ].filter((value): value is number => value !== null && value > 0);

    return timestamps.length > 0 ? new Date(timestamps[0]) : new Date(0);
  }

  private resolveSeasonKey(playedAt: Date): string {
    return String(playedAt.getUTCFullYear());
  }

  private advanceMatchHistoryCursor(input: {
    currentNextStart: number;
    currentComplete: boolean;
    pageRequests: MatchHistoryPageRequest[];
    pageResults: Map<number, string[]>;
    resolvedMatchIds: Set<string>;
  }): {
    matchHistoryNextStart: number;
    matchHistoryComplete: boolean;
  } {
    if (input.currentComplete) {
      return {
        matchHistoryNextStart: input.currentNextStart,
        matchHistoryComplete: true,
      };
    }

    const latestRequest =
      input.pageRequests.find((request) => request.start === 0) ?? {
        start: 0,
        count: 0,
        kind: 'latest' as const,
      };
    let nextStart = input.currentNextStart;
    const latestPage = input.pageResults.get(0) ?? [];

    if (nextStart === 0) {
      if (!this.areAllMatchIdsResolved(latestPage, input.resolvedMatchIds)) {
        return {
          matchHistoryNextStart: 0,
          matchHistoryComplete: false,
        };
      }

      if (latestPage.length < latestRequest.count) {
        return {
          matchHistoryNextStart: 0,
          matchHistoryComplete: true,
        };
      }

      nextStart = latestRequest.count;
    }

    const backfillRequests = input.pageRequests
      .filter((request) => request.kind === 'backfill')
      .sort((left, right) => left.start - right.start);

    for (const request of backfillRequests) {
      if (request.start !== nextStart) {
        break;
      }

      const ids = input.pageResults.get(request.start) ?? [];
      if (!this.areAllMatchIdsResolved(ids, input.resolvedMatchIds)) {
        return {
          matchHistoryNextStart: nextStart,
          matchHistoryComplete: false,
        };
      }

      if (ids.length < request.count) {
        return {
          matchHistoryNextStart: request.start + ids.length,
          matchHistoryComplete: true,
        };
      }

      nextStart = request.start + request.count;
    }

    return {
      matchHistoryNextStart: nextStart,
      matchHistoryComplete: false,
    };
  }

  private areAllMatchIdsResolved(matchIds: string[], resolvedMatchIds: Set<string>): boolean {
    return matchIds.every((matchId) => resolvedMatchIds.has(matchId));
  }

  private calculateMinimumUsableMatches(matchCount: number): number {
    if (matchCount <= 0) {
      return 0;
    }

    return Math.min(matchCount, 5);
  }

  private readNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private readNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private readNullableBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    if (items.length === 0) {
      return [];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private buildRankWarning(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): RiotSyncWarning {
    return {
      code,
      message,
      stage: 'league_lookup',
      details,
    };
  }

  private buildMatchDetailWarning(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): RiotSyncWarning {
    return {
      code,
      message,
      stage: 'match_details',
      details,
    };
  }

  private pickPrimaryWarning(warnings: RiotSyncWarning[]): RiotSyncWarning | null {
    return warnings[0] ?? null;
  }

  private buildSummonerProfileSummary(summoner: RiotSummonerResponse): Record<string, unknown> {
    return {
      puuid: summoner.puuid,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
      revisionDate: summoner.revisionDate?.toISOString() ?? null,
    };
  }

  private async markSyncProgress(input: {
    riotAccountId: string;
    phase: SyncPhase;
    processedMatchCount?: number;
    queuedMatchCount?: number;
    hasUsableSnapshot?: boolean;
  }): Promise<void> {
    const data: Prisma.RiotAccountUpdateInput = {
      syncPhase: input.phase,
      lastSyncProgressAt: new Date(),
    };

    if (input.processedMatchCount !== undefined) {
      data.processedMatchCount = input.processedMatchCount;
    }
    if (input.queuedMatchCount !== undefined) {
      data.queuedMatchCount = input.queuedMatchCount;
    }
    if (input.hasUsableSnapshot !== undefined) {
      data.hasUsableSnapshot = input.hasUsableSnapshot;
    }

    await this.prismaService.riotAccount.update({
      where: { id: input.riotAccountId },
      data,
    });
  }

  private async recoverStaleRunningSync(account: any): Promise<any> {
    if (account.syncStatus !== RiotSyncStatus.RUNNING) {
      return account;
    }

    const referenceTime =
      account.lastSyncProgressAt ?? account.lastSyncRequestedAt ?? account.updatedAt;
    if (Date.now() - referenceTime.getTime() < this.getStaleSyncMs()) {
      return account;
    }

    const failedAt = new Date();
    const message = 'Riot sync stalled without progress and was marked failed.';
    this.logSyncDebug('stale_running_detected', {
      riotAccountId: account.id,
      phase: 'failed',
      lastProgressAt: referenceTime.toISOString(),
      staleMs: this.getStaleSyncMs(),
    });
    const updated = await this.prismaService.riotAccount.update({
      where: { id: account.id },
      data: {
        syncStatus: RiotSyncStatus.FAILED,
        syncPhase: 'failed',
        lastSyncFailedAt: failedAt,
        lastSyncProgressAt: failedAt,
        lastSyncError: message,
        lastSyncErrorCode: 'RIOT_SYNC_STALLED',
        lastSyncErrorMessage: message,
        lastSyncWarningCode: null,
        lastSyncWarningMessage: null,
        hasUsableSnapshot: Boolean(account.lastSyncedAt),
      },
    });
    this.logSyncStateTransition(account.id, RiotSyncStatus.RUNNING, RiotSyncStatus.FAILED, {
      reason: 'stale_recovery',
    });

    return updated;
  }

  private getStaleSyncMs(): number {
    return this.configService.get<number>('RIOT_SYNC_STALE_MS', 900_000);
  }

  private logSyncDebug(event: string, details: Record<string, unknown>): void {
    this.logger.debug(
      `[RiotSyncDebug] ${JSON.stringify({
        event,
        ...this.sanitizeLogDetails(details),
      })}`,
    );
  }

  private logMatchHistoryCoverage(input: {
    userId: string;
    stored: number;
    nextStart: number;
    complete: boolean;
  }): void {
    this.logger.debug(
      `[RiotSyncDebug] userId=${input.userId} action=match_history_coverage stored=${input.stored} nextStart=${input.nextStart} complete=${input.complete}`,
    );
  }

  private logSyncStateTransition(
    riotAccountId: string,
    from: RiotSyncStatus,
    to: RiotSyncStatus,
    details?: Record<string, unknown>,
  ): void {
    this.logSyncDebug('state_transition', {
      riotAccountId,
      phase: 'state_transition',
      from,
      to,
      ...(details ?? {}),
    });
  }

  private logSyncStage(stage: string, details: Record<string, unknown>): void {
    this.logger.debug(
      `[riot_sync] ${JSON.stringify({ stage, ...this.sanitizeLogDetails(details) })}`,
    );
  }

  private logSyncFailure(
    riotAccountId: string,
    accountPuuid: string,
    errorCode: string,
    errorMessage: string,
    nextStatus: RiotSyncStatus,
  ): void {
    this.logger.error(
      `[riot_sync] failure ${JSON.stringify({
        riotAccountId,
        accountPuuid: this.maskPuuid(accountPuuid),
        errorCode,
        errorMessage,
        nextStatus,
      })}`,
    );
  }

  private buildAccountConflictException(
    code: RiotAccountConflictCode,
    message: string,
    details: Record<string, unknown>,
  ): ConflictException {
    return new ConflictException({
      code,
      message,
      details,
    });
  }

  private buildSameUserConflictException(
    matchedBy: 'riot_id_same_user' | 'puuid_same_user',
    riotAccountId: string,
  ): ConflictException {
    return this.buildAccountConflictException(
      'ALREADY_ADDED_BY_THIS_USER',
      'This Riot account has already been added by this user.',
      {
        reason: 'ALREADY_ADDED_BY_THIS_USER',
        matchedBy,
        riotAccountId,
        existingRiotAccountId: riotAccountId,
      },
    );
  }

  private isSameUserRiotAccountConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  // List-visible RiotAccount rows are the only rows allowed to block create.
  // The current model uses hard delete and has no deletedAt/isActive visibility flags.
  private buildListVisibleRiotAccountWhere(userId: string) {
    return { userId };
  }

  private async findListVisibleDuplicateByRiotId(
    userId: string,
    riotGameName: string,
    tagLine: string,
  ): Promise<RiotAccountDuplicateMatch | null> {
    return this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        riotGameName,
        tagLine,
      },
      select: {
        id: true,
        userId: true,
        isPrimary: true,
        puuid: true,
      },
    });
  }

  private async findListVisibleDuplicateByPuuid(
    userId: string,
    puuid: string,
  ): Promise<RiotAccountDuplicateMatch | null> {
    return this.prismaService.riotAccount.findFirst({
      where: {
        ...this.buildListVisibleRiotAccountWhere(userId),
        puuid,
      },
      select: {
        id: true,
        userId: true,
        isPrimary: true,
        puuid: true,
      },
    });
  }

  private logDuplicateCheckResult(
    matchStrategy: 'riot_id_same_user' | 'puuid_same_user',
    match: RiotAccountDuplicateMatch | null,
  ): void {
    this.logAccountEvent('duplicate_check_result', {
      matchStrategy,
      matchedRowId: match?.id ?? null,
      matchedUserId: match?.userId ?? null,
      matchedDeletedAt: null,
      matchedIsPrimary: match?.isPrimary ?? null,
      matchedIsActive: null,
      matchedPuuid: match?.puuid ?? null,
    });
  }

  private logAccountEvent(
    stage: string,
    details: Record<string, unknown>,
  ): void {
    this.logger.debug(
      `[riot_account] ${JSON.stringify({ stage, ...this.sanitizeLogDetails(details) })}`,
    );
  }

  private sanitizeLogDetails(details: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(details).map(([key, value]) => [key, this.sanitizeLogValue(key, value)]),
    );
  }

  private sanitizeLogValue(key: string, value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeLogValue(key, item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
          childKey,
          this.sanitizeLogValue(childKey, childValue),
        ]),
      );
    }

    if (
      typeof value === 'string' &&
      this.isSensitiveLogKey(key)
    ) {
      if (value.includes('...')) {
        return value;
      }
      return this.maskSensitiveValue(value);
    }

    return value;
  }

  private isSensitiveLogKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized.includes('puuid')) {
      return true;
    }

    if (normalized.includes('source')) {
      return false;
    }

    return (
      normalized.endsWith('summonerid') ||
      normalized.includes('encryptedsummonerid')
    );
  }

  private maskSensitiveValue(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    if (value.length <= 4) {
      return '****';
    }

    if (value.length <= 8) {
      return `${value.slice(0, 2)}...${value.slice(-2)}`;
    }

    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  private maskPuuid(puuid: string | null | undefined): string | null {
    return this.maskSensitiveValue(puuid);
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
    primaryQueueType?: string;
    primaryWins?: number;
    primaryLosses?: number;
  } {
    const solo = entries.find((entry) => entry.queueType === 'RANKED_SOLO_5x5');
    const flex = entries.find((entry) => entry.queueType === 'RANKED_FLEX_SR');
    const primary = solo ?? flex;

    return {
      primaryTier: primary?.tier,
      primaryRank: primary?.rank,
      primaryLp: primary?.leaguePoints,
      primaryQueueType: primary?.queueType,
      primaryWins: primary?.wins,
      primaryLosses: primary?.losses,
      queues: entries.map((entry) => ({
        queueType: entry.queueType,
        tier: entry.tier,
        rank: entry.rank,
        lp: entry.leaguePoints,
        wins: entry.wins,
        losses: entry.losses,
        totalGames: entry.wins + entry.losses,
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
    summoner: RiotSummonerResponse,
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
      profile: this.buildSummonerProfileSummary(summoner),
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

  private toSyncStatusResponse(account: {
    id: string;
    syncStatus: RiotSyncStatus;
    lastSyncRequestedAt: Date | null;
    lastSyncSucceededAt: Date | null;
    lastSyncFailedAt: Date | null;
    lastSyncErrorCode: string | null;
    lastSyncErrorMessage: string | null;
    lastSyncWarningCode: string | null;
    lastSyncWarningMessage: string | null;
    profileIconId: number | null;
    summonerLevel: number | null;
    summonerRevisionDate: Date | null;
    lastSyncedAt: Date | null;
    syncPhase: string | null;
    lastSyncProgressAt: Date | null;
    processedMatchCount: number;
    queuedMatchCount: number;
    hasUsableSnapshot: boolean;
  }): RiotAccountSyncStatusResponseDto {
    const estimatedRemaining = Math.max(account.queuedMatchCount - account.processedMatchCount, 0);

    return {
      riotAccountId: account.id,
      syncStatus: account.syncStatus,
      lastSyncRequestedAt: account.lastSyncRequestedAt?.toISOString() ?? null,
      lastSyncSucceededAt: account.lastSyncSucceededAt?.toISOString() ?? null,
      lastSyncFailedAt: account.lastSyncFailedAt?.toISOString() ?? null,
      lastSyncErrorCode: account.lastSyncErrorCode,
      lastSyncErrorMessage: account.lastSyncErrorMessage,
      lastSyncWarningCode: account.lastSyncWarningCode,
      lastSyncWarningMessage: account.lastSyncWarningMessage,
      profileIconId: account.profileIconId,
      summonerLevel: account.summonerLevel,
      summonerRevisionDate: account.summonerRevisionDate?.toISOString() ?? null,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      processedMatchCount: account.queuedMatchCount > 0 ? account.processedMatchCount : null,
      queuedMatchCount: account.queuedMatchCount > 0 ? account.queuedMatchCount : null,
      estimatedRemaining: account.queuedMatchCount > 0 ? estimatedRemaining : null,
      lastProgressAt: account.lastSyncProgressAt?.toISOString() ?? null,
      phase: account.syncPhase,
      isInitialSync: account.lastSyncSucceededAt === null,
      hasUsableSnapshot: account.hasUsableSnapshot || Boolean(account.lastSyncedAt),
    };
  }

  private toResponse(account: {
    id: string;
    riotGameName: string;
    tagLine: string;
    region: string;
    puuid: string;
    profileIconId: number | null;
    summonerLevel: number | null;
    summonerRevisionDate: Date | null;
    isPrimary: boolean;
    verificationStatus: VerificationStatus;
    syncStatus: RiotSyncStatus;
    lastSyncRequestedAt: Date | null;
    lastSyncSucceededAt: Date | null;
    lastSyncFailedAt: Date | null;
    lastSyncErrorCode: string | null;
    lastSyncErrorMessage: string | null;
    lastSyncWarningCode: string | null;
    lastSyncWarningMessage: string | null;
    lastSyncedAt: Date | null;
  }): RiotAccountResponseDto {
    const routing = this.resolveRoutingForStoredAccount(account.region);

    return {
      id: account.id,
      riotGameName: account.riotGameName,
      tagLine: account.tagLine,
      region: account.region,
      platformRegion: routing.platformRegion,
      accountRegion: routing.accountRegion,
      puuid: account.puuid,
      profileIconId: account.profileIconId,
      summonerLevel: account.summonerLevel,
      summonerRevisionDate: account.summonerRevisionDate?.toISOString() ?? null,
      isPrimary: account.isPrimary,
      verificationStatus: account.verificationStatus,
      syncStatus: account.syncStatus,
      lastSyncRequestedAt: account.lastSyncRequestedAt?.toISOString() ?? null,
      lastSyncSucceededAt: account.lastSyncSucceededAt?.toISOString() ?? null,
      lastSyncFailedAt: account.lastSyncFailedAt?.toISOString() ?? null,
      lastSyncErrorCode: account.lastSyncErrorCode,
      lastSyncErrorMessage: account.lastSyncErrorMessage,
      lastSyncWarningCode: account.lastSyncWarningCode,
      lastSyncWarningMessage: account.lastSyncWarningMessage,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
    };
  }
}
