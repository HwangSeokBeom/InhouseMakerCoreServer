import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RiotSyncStatus, VerificationStatus } from '@prisma/client';

import { RiotApiError } from '../src/riot/riot-api.client';
import { RiotService } from '../src/riot/riot.service';

type RiotAccountRow = {
  id: string;
  userId: string;
  riotGameName: string;
  tagLine: string;
  region: string;
  puuid: string;
  summonerId: string | null;
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
  lastSyncError: string | null;
  syncPhase: string | null;
  lastSyncProgressAt: Date | null;
  processedMatchCount: number;
  queuedMatchCount: number;
  hasUsableSnapshot: boolean;
  matchHistoryNextStart: number;
  matchHistoryComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type SnapshotRow = {
  id: string;
  riotAccountId: string;
};

type ParticipantSummaryRow = {
  riotMatchId: string;
  puuid: string;
  queueCategory: string;
  championId: number | null;
  championKey: string | null;
  championName: string | null;
  kills: number;
  deaths: number;
  assists: number;
  didWin: boolean | null;
  playedAt: Date;
  seasonKey: string;
};

class InMemoryRiotPrisma {
  private nextAccountId = 1;
  private nextSnapshotId = 1;
  private createdAtCounter = 1;

  readonly state = {
    accounts: [] as RiotAccountRow[],
    snapshots: [] as SnapshotRow[],
  };

  readonly riotAccount: any = {
    findUnique: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      const account = this.state.accounts.find((item) => {
        if (where.id) {
          return item.id === where.id;
        }
        if (where.puuid) {
          return item.puuid === where.puuid;
        }
        return false;
      });

      return account ? this.pick(account, args?.select) : null;
    }),
    findUniqueOrThrow: jest.fn(async (args: any): Promise<any> => {
      const account = await this.riotAccount.findUnique(args);
      if (!account) {
        throw new Error('Account not found');
      }
      return account;
    }),
    findFirst: jest.fn(async (args: any) => {
      const filtered = this.filterAccounts(args?.where);
      const ordered = this.orderAccounts(filtered, args?.orderBy);
      const account = ordered[0];
      return account ? this.pick(account, args?.select) : null;
    }),
    findMany: jest.fn(async (args?: any) => {
      const filtered = this.filterAccounts(args?.where);
      const ordered = this.orderAccounts(filtered, args?.orderBy);
      return ordered.map((account) => this.pick(account, args?.select));
    }),
    create: jest.fn(async (args: any) => {
      const now = new Date(this.createdAtCounter++ * 1000);
      const account: RiotAccountRow = {
        id: `ra_${this.nextAccountId++}`,
        userId: args.data.userId,
        riotGameName: args.data.riotGameName,
        tagLine: args.data.tagLine,
        region: args.data.region,
        puuid: args.data.puuid,
        summonerId: args.data.summonerId ?? null,
        profileIconId: args.data.profileIconId ?? null,
        summonerLevel: args.data.summonerLevel ?? null,
        summonerRevisionDate: args.data.summonerRevisionDate ?? null,
        isPrimary: args.data.isPrimary ?? false,
        verificationStatus: args.data.verificationStatus,
        syncStatus: args.data.syncStatus ?? RiotSyncStatus.IDLE,
        lastSyncRequestedAt: null,
        lastSyncSucceededAt: null,
        lastSyncFailedAt: null,
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        lastSyncWarningCode: null,
        lastSyncWarningMessage: null,
        lastSyncedAt: null,
        lastSyncError: null,
        syncPhase: null,
        lastSyncProgressAt: null,
        processedMatchCount: 0,
        queuedMatchCount: 0,
        hasUsableSnapshot: false,
        matchHistoryNextStart: args.data.matchHistoryNextStart ?? 0,
        matchHistoryComplete: args.data.matchHistoryComplete ?? false,
        createdAt: now,
        updatedAt: now,
      };
      this.state.accounts.push(account);
      return this.pick(account, args?.select);
    }),
    update: jest.fn(async (args: any) => {
      const account = this.state.accounts.find((item) => item.id === args.where.id);
      if (!account) {
        throw new Error('Account not found');
      }
      Object.assign(account, args.data, { updatedAt: new Date() });
      return this.pick(account, args?.select);
    }),
    updateMany: jest.fn(async (args: any) => {
      const accounts = this.filterAccounts(args.where);
      for (const account of accounts) {
        Object.assign(account, args.data, { updatedAt: new Date() });
      }
      return { count: accounts.length };
    }),
    delete: jest.fn(async (args: any) => {
      const index = this.state.accounts.findIndex((item) => item.id === args.where.id);
      if (index === -1) {
        throw new Error('Account not found');
      }
      const [account] = this.state.accounts.splice(index, 1);
      this.state.snapshots = this.state.snapshots.filter(
        (snapshot) => snapshot.riotAccountId !== account.id,
      );
      return account;
    }),
  };

  readonly riotAccountSnapshot = {
    create: jest.fn(async (args: any) => {
      const row: SnapshotRow = {
        id: `snap_${this.nextSnapshotId++}`,
        riotAccountId: args.data.riotAccountId,
      };
      this.state.snapshots.push(row);
      return row;
    }),
  };

  readonly $transaction = jest.fn(async (arg: any) => {
    if (typeof arg === 'function') {
      return arg(this);
    }
    return Promise.all(arg);
  });

  seedAccount(
    overrides: Partial<RiotAccountRow> & Pick<RiotAccountRow, 'userId' | 'riotGameName' | 'tagLine' | 'region' | 'puuid'>,
  ): RiotAccountRow {
    const now = new Date(this.createdAtCounter++ * 1000);
    const account: RiotAccountRow = {
      id: overrides.id ?? `ra_${this.nextAccountId++}`,
      userId: overrides.userId,
      riotGameName: overrides.riotGameName,
      tagLine: overrides.tagLine,
      region: overrides.region,
      puuid: overrides.puuid,
      summonerId: overrides.summonerId ?? null,
      profileIconId: overrides.profileIconId ?? null,
      summonerLevel: overrides.summonerLevel ?? null,
      summonerRevisionDate: overrides.summonerRevisionDate ?? null,
      isPrimary: overrides.isPrimary ?? false,
      verificationStatus: overrides.verificationStatus ?? VerificationStatus.CLAIMED,
      syncStatus: overrides.syncStatus ?? RiotSyncStatus.IDLE,
      lastSyncRequestedAt: overrides.lastSyncRequestedAt ?? null,
      lastSyncSucceededAt: overrides.lastSyncSucceededAt ?? null,
      lastSyncFailedAt: overrides.lastSyncFailedAt ?? null,
      lastSyncErrorCode: overrides.lastSyncErrorCode ?? null,
      lastSyncErrorMessage: overrides.lastSyncErrorMessage ?? null,
      lastSyncWarningCode: overrides.lastSyncWarningCode ?? null,
      lastSyncWarningMessage: overrides.lastSyncWarningMessage ?? null,
      lastSyncedAt: overrides.lastSyncedAt ?? null,
      lastSyncError: overrides.lastSyncError ?? null,
      syncPhase: overrides.syncPhase ?? null,
      lastSyncProgressAt: overrides.lastSyncProgressAt ?? null,
      processedMatchCount: overrides.processedMatchCount ?? 0,
      queuedMatchCount: overrides.queuedMatchCount ?? 0,
      hasUsableSnapshot: overrides.hasUsableSnapshot ?? false,
      matchHistoryNextStart: overrides.matchHistoryNextStart ?? 0,
      matchHistoryComplete: overrides.matchHistoryComplete ?? false,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };
    this.state.accounts.push(account);
    return account;
  }

  private filterAccounts(where?: Record<string, unknown>): RiotAccountRow[] {
    return this.state.accounts.filter((account) => {
      if (!where) {
        return true;
      }

      return Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && 'not' in (value as Record<string, unknown>)) {
          return account[key as keyof RiotAccountRow] !== (value as Record<string, unknown>).not;
        }
        return account[key as keyof RiotAccountRow] === value;
      });
    });
  }

  private orderAccounts(
    accounts: RiotAccountRow[],
    orderBy?: Array<Record<string, 'asc' | 'desc'>> | Record<string, 'asc' | 'desc'>,
  ): RiotAccountRow[] {
    const rules = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    if (rules.length === 0) {
      return [...accounts];
    }

    return [...accounts].sort((left, right) => {
      for (const rule of rules) {
        const [key, direction] = Object.entries(rule)[0];
        const leftValue = left[key as keyof RiotAccountRow];
        const rightValue = right[key as keyof RiotAccountRow];

        if (leftValue === rightValue) {
          continue;
        }

        const leftComparable =
          leftValue instanceof Date
            ? leftValue.getTime()
            : typeof leftValue === 'boolean'
              ? Number(leftValue)
              : typeof leftValue === 'number'
                ? leftValue
                : String(leftValue);
        const rightComparable =
          rightValue instanceof Date
            ? rightValue.getTime()
            : typeof rightValue === 'boolean'
              ? Number(rightValue)
              : typeof rightValue === 'number'
                ? rightValue
                : String(rightValue);

        if (direction === 'desc') {
          return leftComparable < rightComparable ? 1 : -1;
        }
        return leftComparable > rightComparable ? 1 : -1;
      }

      return 0;
    });
  }

  private pick<T extends Record<string, unknown>>(value: T, select?: Record<string, boolean>) {
    if (!select) {
      return { ...value };
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, enabled]) => enabled)
        .map(([key]) => [key, value[key as keyof T]]),
    );
  }
}

describe('RiotService', () => {
  const createUniqueConstraintError = () => {
    const error = new Error('Unique constraint failed.') as Prisma.PrismaClientKnownRequestError;
    Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
    Object.assign(error, {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['user_id', 'puuid'] },
    });
    return error;
  };

  const createService = () => {
    const prismaService = new InMemoryRiotPrisma();
    const participantSummaries: ParticipantSummaryRow[] = [];
    const riotApiClient = {
      getSummonerByPuuid: jest.fn(),
      getRankedEntriesByPuuid: jest.fn(),
      getRecentMatchIds: jest.fn(),
      getMatchDetail: jest.fn(),
      resolveAccountByRiotId: jest.fn(),
    };
    const queueService = {
      enqueuePowerRecalculation: jest.fn().mockResolvedValue(undefined),
      enqueueRiotAccountInitialSync: jest.fn().mockResolvedValue(undefined),
      enqueueRiotAccountRefresh: jest.fn().mockResolvedValue(undefined),
      cancelRiotSyncJobs: jest.fn().mockResolvedValue(0),
    };
    const auditLogService = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'RIOT_PLATFORM_REGION') {
          return 'kr';
        }
        throw new Error(`Unexpected config key ${key}`);
      }),
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'RIOT_MATCH_HISTORY_PAGE_SIZE') {
          return 20;
        }
        if (key === 'RIOT_INITIAL_SYNC_MATCH_COUNT') {
          return 25;
        }
        if (key === 'RIOT_MATCH_HISTORY_EXTRA_PAGES_PER_SYNC') {
          return 0;
        }
        if (key === 'RIOT_MATCH_DETAIL_BATCH_SIZE') {
          return 5;
        }
        if (key === 'RIOT_SYNC_STALE_MS') {
          return 60_000;
        }
        return defaultValue;
      }),
    };
    const riotMatchHistoryRepository = {
      findKnownMatchIds: jest.fn(async (puuid: string, matchIds: string[]) => {
        return new Set(
          participantSummaries
            .filter((row) => row.puuid === puuid && matchIds.includes(row.riotMatchId))
            .map((row) => row.riotMatchId),
        );
      }),
      createParticipantSummaries: jest.fn(async (rows: ParticipantSummaryRow[]) => {
        for (const row of rows) {
          const exists = participantSummaries.some(
            (candidate) =>
              candidate.riotMatchId === row.riotMatchId && candidate.puuid === row.puuid,
          );
          if (!exists) {
            participantSummaries.push({ ...row });
          }
        }
      }),
      findChampionHistoryByPuuid: jest.fn(async (puuid: string) => {
        return participantSummaries
          .filter((row) => row.puuid === puuid && row.queueCategory !== 'IGNORED')
          .map((row) => ({ ...row }))
          .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
      }),
    };

    return {
      prismaService,
      participantSummaries,
      riotApiClient,
      queueService,
      auditLogService,
      riotMatchHistoryRepository,
      service: new RiotService(
        prismaService as any,
        riotApiClient as any,
        queueService as any,
        auditLogService as any,
        configService as any,
        riotMatchHistoryRepository as any,
      ),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const expectConflict = async (
    operation: Promise<unknown>,
    code: 'ALREADY_ADDED_BY_THIS_USER',
    matchedBy?: 'riot_id_same_user' | 'puuid_same_user',
  ) => {
    try {
      await operation;
      throw new Error('Expected a conflict exception.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as Record<string, any>;
      expect(response).toMatchObject({
        code,
        details: {
          reason: code,
        },
      });
      if (matchedBy) {
        expect(response).toMatchObject({
          details: {
            matchedBy,
          },
        });
      }
      return response;
    }
  };

  it('creates a Riot account with parsed Riot ID and normalized routing', async () => {
    const { service, riotApiClient, queueService } = createService();
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-1',
      gameName: '잘해버리자너',
      tagLine: 'KR1',
    });

    const result = await service.createForUser('u1', {
      riotGameName: '잘해버리자너#KR1',
      region: 'KR',
      isPrimary: true,
    });

    expect(riotApiClient.resolveAccountByRiotId).toHaveBeenCalledWith(
      '잘해버리자너',
      'KR1',
      'asia',
    );
    expect(queueService.enqueueRiotAccountInitialSync).toHaveBeenCalled();
    expect(result).toMatchObject({
      riotGameName: '잘해버리자너',
      tagLine: 'KR1',
      region: 'kr',
      platformRegion: 'kr',
      accountRegion: 'asia',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    expect(result.lastSyncRequestedAt).not.toBeNull();
  });

  it('returns a same-user conflict when the exact Riot ID is already added by the current user', async () => {
    const { service, riotApiClient } = createService();
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-1',
      gameName: '잘해버리자너',
      tagLine: 'KR1',
    });

    await service.createForUser('u1', {
      riotGameName: '잘해버리자너',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });
    await expect(service.listForUser('u1')).resolves.toMatchObject({
      items: [{ riotGameName: '잘해버리자너', tagLine: 'KR1' }],
    });

    const response = await expectConflict(
      service.createForUser('u1', {
        riotGameName: '잘해버리자너',
        tagLine: 'KR1',
        region: 'kr',
        isPrimary: true,
      }),
      'ALREADY_ADDED_BY_THIS_USER',
      'riot_id_same_user',
    );
    expect(response).toMatchObject({
      details: {
        riotAccountId: 'ra_1',
        existingRiotAccountId: 'ra_1',
      },
    });
  });

  it('allows different users to add the same Riot ID and only lists user-scoped rows', async () => {
    const { service, riotApiClient } = createService();
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'shared-puuid-1',
      gameName: '공용계정',
      tagLine: 'KR1',
    });

    const createdByUserA = await service.createForUser('u1', {
      riotGameName: '공용계정',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });
    const createdByUserB = await service.createForUser('u2', {
      riotGameName: '공용계정',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });

    expect(createdByUserA.id).not.toBe(createdByUserB.id);
    expect(createdByUserA.puuid).toBe('shared-puuid-1');
    expect(createdByUserB.puuid).toBe('shared-puuid-1');

    await expect(service.listForUser('u1')).resolves.toMatchObject({
      items: [{ id: createdByUserA.id, riotGameName: '공용계정', tagLine: 'KR1' }],
    });
    await expect(service.listForUser('u2')).resolves.toMatchObject({
      items: [{ id: createdByUserB.id, riotGameName: '공용계정', tagLine: 'KR1' }],
    });
  });

  it('returns a same-user conflict when the same puuid is already added under another Riot ID label', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra_existing',
      userId: 'u1',
      riotGameName: 'OldName',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
    });
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-1',
      gameName: 'NewName',
      tagLine: 'KR1',
    });

    const response = await expectConflict(
      service.createForUser('u1', {
        riotGameName: 'NewName',
        tagLine: 'KR1',
        region: 'kr',
      }),
      'ALREADY_ADDED_BY_THIS_USER',
      'puuid_same_user',
    );
    expect(response).toMatchObject({
      details: {
        riotAccountId: 'ra_existing',
        existingRiotAccountId: 'ra_existing',
      },
    });
  });

  it('rejects malformed Riot IDs', async () => {
    const { service } = createService();

    await expect(
      service.createForUser('u1', {
        riotGameName: 'broken#',
        region: 'kr',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes sync calls with platform region for summoner and league, and account region for matches', async () => {
    const { service, prismaService, riotApiClient, queueService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'NorthPlayer',
      tagLine: 'NA1',
      region: 'na1',
      puuid: 'puuid-na',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-na',
      encryptedSummonerId: 'summoner-1',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 101,
      summonerLevel: 222,
      revisionDate: new Date('2026-04-14T12:00:00.000Z'),
      rawResponse: {
        id: 'summoner-1',
        puuid: 'puuid-na',
        profileIconId: 101,
        revisionDate: 1713096000000,
        summonerLevel: 222,
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([
      {
        queueType: 'RANKED_SOLO_5x5',
        tier: 'GOLD',
        rank: 'II',
        leaguePoints: 50,
        wins: 10,
        losses: 8,
      },
    ]);
    riotApiClient.getRecentMatchIds.mockResolvedValue(['match-1']);
    riotApiClient.getMatchDetail.mockResolvedValue({
      info: {
        participants: [
          {
            puuid: 'puuid-na',
            win: true,
            kills: 5,
            deaths: 2,
            assists: 7,
            visionScore: 20,
            individualPosition: 'MID',
            challenges: {
              killParticipation: 0.6,
              goldPerMinute: 420,
            },
          },
        ],
      },
    });

    await service.syncAccount('ra1');

    expect(riotApiClient.getSummonerByPuuid).toHaveBeenCalledWith('puuid-na', 'na1');
    expect(riotApiClient.getRankedEntriesByPuuid).toHaveBeenCalledWith('puuid-na', 'na1');
    expect(riotApiClient.getRecentMatchIds).toHaveBeenCalledWith(
      'puuid-na',
      25,
      0,
      'americas',
    );
    expect(riotApiClient.getMatchDetail).toHaveBeenCalledWith('match-1', 'americas');
    const updated = prismaService.state.accounts.find((account) => account.id === 'ra1');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.SUCCEEDED);
    expect(updated?.summonerId).toBe('summoner-1');
    expect(updated?.profileIconId).toBe(101);
    expect(updated?.summonerLevel).toBe(222);
    expect(updated?.lastSyncWarningCode).toBeNull();
    expect(updated?.lastSyncedAt).not.toBeNull();
    expect(queueService.enqueuePowerRecalculation).toHaveBeenCalledWith('u1', 'riot-sync');
  });

  it('continues ranked lookup with puuid even when encrypted summoner id is missing', async () => {
    const { service, prismaService, riotApiClient, queueService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Test',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-1',
      encryptedSummonerId: null,
      encryptedSummonerIdSourceField: 'none',
      profileIconId: 12,
      summonerLevel: 55,
      revisionDate: new Date('2026-04-14T11:00:00.000Z'),
      rawResponse: {
        puuid: 'puuid-1',
        profileIconId: 12,
        revisionDate: 1713092400000,
        summonerLevel: 55,
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([
      {
        queueType: 'RANKED_SOLO_5x5',
        tier: 'SILVER',
        rank: 'II',
        leaguePoints: 33,
        wins: 12,
        losses: 10,
      },
    ]);
    riotApiClient.getRecentMatchIds.mockResolvedValue(['match-1']);
    riotApiClient.getMatchDetail.mockResolvedValue({
      info: {
        participants: [
          {
            puuid: 'puuid-1',
            summonerId: 'match-derived-summoner-id',
            win: false,
            kills: 1,
            deaths: 3,
            assists: 9,
            visionScore: 18,
            teamPosition: 'UTILITY',
            challenges: {
              killParticipation: 0.7,
              goldPerMinute: 300,
            },
          },
        ],
      },
    });

    await service.syncAccount('ra1');

    expect(riotApiClient.getRankedEntriesByPuuid).toHaveBeenCalledWith('puuid-1', 'kr');
    const updated = prismaService.state.accounts.find((account) => account.id === 'ra1');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.SUCCEEDED);
    expect(updated?.lastSyncErrorCode).toBeNull();
    expect(updated?.summonerId).toBe('match-derived-summoner-id');
    expect(updated?.lastSyncWarningCode).toBeNull();
    expect(updated?.lastSyncedAt).not.toBeNull();
    expect(queueService.enqueuePowerRecalculation).toHaveBeenCalledWith('u1', 'riot-sync');
  });

  it('keeps the stored summoner id when the current summoner response omits it', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Test',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      summonerId: 'stored-summoner-id',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-1',
      encryptedSummonerId: null,
      encryptedSummonerIdSourceField: 'none',
      profileIconId: 10,
      summonerLevel: 120,
      revisionDate: new Date('2026-04-14T11:30:00.000Z'),
      rawResponse: {
        puuid: 'puuid-1',
        profileIconId: 10,
        revisionDate: 1713094200000,
        summonerLevel: 120,
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([]);
    riotApiClient.getRecentMatchIds.mockResolvedValue([]);

    await service.syncAccount('ra1');

    expect(riotApiClient.getRankedEntriesByPuuid).toHaveBeenCalledWith('puuid-1', 'kr');
    const updated = prismaService.state.accounts.find((account) => account.id === 'ra1');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.SUCCEEDED);
    expect(updated?.summonerId).toBe('stored-summoner-id');
    expect(updated?.lastSyncWarningCode).toBeNull();
  });

  it('marks sync as partial when ranked lookup fails but match sync succeeds', async () => {
    const { service, prismaService, riotApiClient, queueService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Test',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-1',
      encryptedSummonerId: 'summoner-1',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 99,
      summonerLevel: 210,
      revisionDate: new Date('2026-04-14T12:15:00.000Z'),
      rawResponse: {
        id: 'summoner-1',
        puuid: 'puuid-1',
        profileIconId: 99,
        revisionDate: 1713096900000,
        summonerLevel: 210,
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockRejectedValue(
      new RiotApiError('league unavailable', 'RIOT_UPSTREAM_ERROR', HttpStatus.BAD_GATEWAY, true),
    );
    riotApiClient.getRecentMatchIds.mockResolvedValue(['match-1']);
    riotApiClient.getMatchDetail.mockResolvedValue({
      info: {
        participants: [
          {
            puuid: 'puuid-1',
            win: true,
            kills: 8,
            deaths: 1,
            assists: 4,
            visionScore: 16,
            individualPosition: 'TOP',
            challenges: {
              killParticipation: 0.5,
              goldPerMinute: 400,
            },
          },
        ],
      },
    });

    await service.syncAccount('ra1');

    const updated = prismaService.state.accounts.find((account) => account.id === 'ra1');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.PARTIAL);
    expect(updated?.lastSyncWarningCode).toBe('RIOT_RANK_SYNC_UNAVAILABLE');
    expect(updated?.lastSyncErrorCode).toBeNull();
    expect(queueService.enqueuePowerRecalculation).toHaveBeenCalledWith('u1', 'riot-sync');
  });

  it('keeps initial sync lightweight and finalizes after the first recent match window', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra_initial',
      userId: 'u1',
      riotGameName: 'Initial',
      tagLine: 'NA1',
      region: 'na1',
      puuid: 'puuid-initial',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-initial',
      encryptedSummonerId: 'summoner-initial',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 18,
      summonerLevel: 44,
      revisionDate: new Date('2026-04-20T10:00:00.000Z'),
      rawResponse: {
        id: 'summoner-initial',
        puuid: 'puuid-initial',
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([]);
    riotApiClient.getRecentMatchIds.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => `match-${index + 1}`),
    );
    riotApiClient.getMatchDetail.mockImplementation(async (matchId: string) => ({
      info: {
        queueId: 420,
        gameMode: 'CLASSIC',
        gameType: 'MATCHED_GAME',
        mapId: 11,
        gameEndTimestamp: Date.parse('2026-04-20T10:30:00.000Z'),
        participants: [
          {
            puuid: 'puuid-initial',
            championId: 1,
            championName: 'Annie',
            summonerId: 'summoner-initial',
            win: matchId !== 'match-2',
            kills: 7,
            deaths: 3,
            assists: 5,
            visionScore: 20,
            individualPosition: 'MID',
            challenges: {
              killParticipation: 0.6,
              goldPerMinute: 410,
            },
          },
        ],
      },
    }));

    await service.syncAccount('ra_initial', 'initial');

    expect(riotApiClient.getRecentMatchIds).toHaveBeenCalledTimes(1);
    expect(riotApiClient.getRecentMatchIds).toHaveBeenCalledWith(
      'puuid-initial',
      25,
      0,
      'americas',
    );
    const updated = prismaService.state.accounts.find((account) => account.id === 'ra_initial');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.SUCCEEDED);
    expect(updated?.matchHistoryNextStart).toBe(25);
    expect(updated?.queuedMatchCount).toBe(25);
    expect(updated?.processedMatchCount).toBe(25);
    expect(updated?.hasUsableSnapshot).toBe(true);
  });

  it('finalizes as partial when some match details fail but a usable initial snapshot exists', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra_partial_match',
      userId: 'u1',
      riotGameName: 'Partial',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-partial',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-partial',
      encryptedSummonerId: 'summoner-partial',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 31,
      summonerLevel: 88,
      revisionDate: new Date('2026-04-20T11:00:00.000Z'),
      rawResponse: {
        id: 'summoner-partial',
        puuid: 'puuid-partial',
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([]);
    riotApiClient.getRecentMatchIds.mockResolvedValue([
      'match-1',
      'match-2',
      'match-3',
      'match-4',
      'match-5',
      'match-6',
    ]);
    riotApiClient.getMatchDetail.mockImplementation(async (matchId: string) => {
      if (matchId === 'match-6') {
        throw new Error('timeout');
      }

      return {
        info: {
          queueId: 420,
          gameMode: 'CLASSIC',
          gameType: 'MATCHED_GAME',
          mapId: 11,
          gameEndTimestamp: Date.parse('2026-04-20T11:30:00.000Z'),
          participants: [
            {
              puuid: 'puuid-partial',
              championId: 99,
              championName: 'Lux',
              summonerId: 'summoner-partial',
              win: true,
              kills: 8,
              deaths: 2,
              assists: 10,
              visionScore: 21,
              teamPosition: 'UTILITY',
              challenges: {
                killParticipation: 0.71,
                goldPerMinute: 330,
              },
            },
          ],
        },
      };
    });

    await service.syncAccount('ra_partial_match', 'initial');

    const updated = prismaService.state.accounts.find((account) => account.id === 'ra_partial_match');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.PARTIAL);
    expect(updated?.lastSyncWarningCode).toBe('RIOT_MATCH_DETAIL_PARTIAL');
    expect(updated?.processedMatchCount).toBe(6);
    expect(updated?.queuedMatchCount).toBe(6);
    expect(updated?.hasUsableSnapshot).toBe(true);
  });

  it('fails the sync when recent match detail coverage is too low to build a usable snapshot', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra_failed_match',
      userId: 'u1',
      riotGameName: 'Failed',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-failed',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-failed',
      encryptedSummonerId: 'summoner-failed',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 41,
      summonerLevel: 102,
      revisionDate: new Date('2026-04-20T12:00:00.000Z'),
      rawResponse: {
        id: 'summoner-failed',
        puuid: 'puuid-failed',
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([]);
    riotApiClient.getRecentMatchIds.mockResolvedValue([
      'match-1',
      'match-2',
      'match-3',
      'match-4',
      'match-5',
      'match-6',
    ]);
    riotApiClient.getMatchDetail.mockImplementation(async (matchId: string) => {
      if (['match-5', 'match-6'].includes(matchId)) {
        throw new Error('timeout');
      }

      return {
        info: {
          queueId: 420,
          gameMode: 'CLASSIC',
          gameType: 'MATCHED_GAME',
          mapId: 11,
          gameEndTimestamp: Date.parse('2026-04-20T12:30:00.000Z'),
          participants: [
            {
              puuid: 'puuid-failed',
              championId: 222,
              championName: 'Jinx',
              summonerId: 'summoner-failed',
              win: true,
              kills: 10,
              deaths: 4,
              assists: 6,
              visionScore: 17,
              teamPosition: 'BOTTOM',
              challenges: {
                killParticipation: 0.64,
                goldPerMinute: 405,
              },
            },
          ],
        },
      };
    });

    await service.syncAccount('ra_failed_match', 'initial');

    const updated = prismaService.state.accounts.find((account) => account.id === 'ra_failed_match');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.FAILED);
    expect(updated?.lastSyncErrorCode).toBe('RIOT_MATCH_DETAIL_INCOMPLETE');
    expect(updated?.hasUsableSnapshot).toBe(false);
  });

  it('recovers stale running syncs during sync-status reads', async () => {
    const { service, prismaService } = createService();
    prismaService.seedAccount({
      id: 'ra_stale',
      userId: 'u1',
      riotGameName: 'Stale',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-stale',
      syncStatus: RiotSyncStatus.RUNNING,
      lastSyncRequestedAt: new Date(0),
      lastSyncProgressAt: new Date(0),
      updatedAt: new Date(0),
    });

    const status = await service.getSyncStatus('u1', 'ra_stale');

    expect(status.syncStatus).toBe(RiotSyncStatus.FAILED);
    expect(status.lastSyncErrorCode).toBe('RIOT_SYNC_STALLED');
    expect(status.phase).toBe('failed');
    const updated = prismaService.state.accounts.find((account) => account.id === 'ra_stale');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.FAILED);
  });

  it('does not duplicate champion history rows when the same sync runs twice', async () => {
    const { service, prismaService, riotApiClient, participantSummaries } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Dupes',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-dup',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'puuid-dup',
      encryptedSummonerId: 'summoner-dup',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 99,
      summonerLevel: 88,
      revisionDate: new Date('2026-04-18T00:00:00.000Z'),
      rawResponse: {
        id: 'summoner-dup',
        puuid: 'puuid-dup',
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([]);
    riotApiClient.getRecentMatchIds.mockResolvedValue(['match-dup-1']);
    riotApiClient.getMatchDetail.mockResolvedValue({
      info: {
        queueId: 420,
        gameMode: 'CLASSIC',
        gameType: 'MATCHED_GAME',
        mapId: 11,
        gameEndTimestamp: Date.parse('2026-04-18T01:00:00.000Z'),
        participants: [
          {
            puuid: 'puuid-dup',
            championId: 266,
            championName: 'Aatrox',
            win: true,
            kills: 9,
            deaths: 2,
            assists: 5,
            visionScore: 18,
            individualPosition: 'TOP',
            challenges: {
              killParticipation: 0.62,
              goldPerMinute: 410,
            },
          },
        ],
      },
    });

    await service.syncAccount('ra1');
    await service.syncAccount('ra1');

    expect(participantSummaries).toHaveLength(1);
    expect(participantSummaries[0]).toMatchObject({
      riotMatchId: 'match-dup-1',
      puuid: 'puuid-dup',
      championKey: 'Aatrox',
      queueCategory: 'RANKED_SOLO',
    });
  });

  it('marks sync as failed on a non-retryable Riot 400 error', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Test',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    riotApiClient.getSummonerByPuuid.mockRejectedValue(
      new RiotApiError('bad request', 'RIOT_CLIENT_ERROR', HttpStatus.BAD_REQUEST, false),
    );

    await service.syncAccount('ra1');

    const updated = prismaService.state.accounts.find((account) => account.id === 'ra1');
    expect(updated?.syncStatus).toBe(RiotSyncStatus.FAILED);
    expect(updated?.lastSyncErrorCode).toBe('RIOT_CLIENT_ERROR');
  });

  it('keeps isPrimary scoped to each user when primary changes', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'u1_primary',
      userId: 'u1',
      riotGameName: 'UserOnePrimary',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-u1-primary',
      isPrimary: true,
    });
    prismaService.seedAccount({
      id: 'u2_primary',
      userId: 'u2',
      riotGameName: 'SharedPrimary',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-shared',
      isPrimary: true,
    });
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-u1-new',
      gameName: 'UserOneNewPrimary',
      tagLine: 'KR1',
    });

    const created = await service.createForUser('u1', {
      riotGameName: 'UserOneNewPrimary',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });

    expect(created.isPrimary).toBe(true);
    expect(
      prismaService.state.accounts.find((account) => account.id === 'u1_primary')?.isPrimary,
    ).toBe(false);
    expect(
      prismaService.state.accounts.find((account) => account.id === 'u2_primary')?.isPrimary,
    ).toBe(true);
  });

  it('deletes a Riot account and returns the remaining list', async () => {
    const { service, prismaService, queueService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Primary',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
    });
    prismaService.seedAccount({
      id: 'ra2',
      userId: 'u1',
      riotGameName: 'Reference',
      tagLine: '0714',
      region: 'kr',
      puuid: 'puuid-2',
      isPrimary: false,
    });
    queueService.cancelRiotSyncJobs.mockResolvedValue(1);

    const result = await service.deleteForUser('u1', 'ra2');

    expect(result).toMatchObject({
      deletedRiotAccountId: 'ra2',
      deletedWasPrimary: false,
      nextPrimaryRiotAccountId: null,
      removedQueuedSyncJobs: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ra1');
  });

  it('blocks deleting another user’s Riot account', async () => {
    const { service, prismaService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u2',
      riotGameName: 'OtherUser',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
    });

    await expect(service.deleteForUser('u1', 'ra1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('promotes the oldest remaining account when deleting the primary account', async () => {
    const { service, prismaService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'Primary',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
      createdAt: new Date(1000),
    });
    prismaService.seedAccount({
      id: 'ra2',
      userId: 'u1',
      riotGameName: 'OldestRef',
      tagLine: '0714',
      region: 'kr',
      puuid: 'puuid-2',
      isPrimary: false,
      createdAt: new Date(2000),
    });
    prismaService.seedAccount({
      id: 'ra3',
      userId: 'u1',
      riotGameName: 'NewestRef',
      tagLine: '9999',
      region: 'kr',
      puuid: 'puuid-3',
      isPrimary: false,
      createdAt: new Date(3000),
    });

    const result = await service.deleteForUser('u1', 'ra1');

    expect(result.deletedWasPrimary).toBe(true);
    expect(result.nextPrimaryRiotAccountId).toBe('ra2');
    expect(result.items[0]).toMatchObject({
      id: 'ra2',
      isPrimary: true,
    });
  });

  it('allows deleting the last Riot account and leaves no primary', async () => {
    const { service, prismaService } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'OnlyOne',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
    });

    const result = await service.deleteForUser('u1', 'ra1');

    expect(result).toMatchObject({
      deletedRiotAccountId: 'ra1',
      deletedWasPrimary: true,
      nextPrimaryRiotAccountId: null,
    });
    expect(result.items).toEqual([]);
  });

  it('allows reconnecting the same Riot account after the current user deletes it', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: '삭제전',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
    });

    await service.deleteForUser('u1', 'ra1');
    expect(await service.listForUser('u1')).toEqual({ items: [] });

    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-1',
      gameName: '삭제전',
      tagLine: 'KR1',
    });

    const recreated = await service.createForUser('u1', {
      riotGameName: '삭제전',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });

    expect(recreated.id).not.toBe('ra1');
    expect(recreated.isPrimary).toBe(true);
    expect(prismaService.state.accounts).toHaveLength(1);
    expect(prismaService.state.accounts[0]).toMatchObject({
      userId: 'u1',
      puuid: 'puuid-1',
      isPrimary: true,
    });
  });

  it('does not return duplicate 409 when the current list is empty and a raw unique error occurs without a visible row', async () => {
    const { service, prismaService, riotApiClient } = createService();
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-unique-race',
      gameName: 'InvisibleDuplicate',
      tagLine: 'KR1',
    });
    prismaService.riotAccount.create.mockImplementationOnce(async () => {
      throw createUniqueConstraintError();
    });

    await expect(service.listForUser('u1')).resolves.toEqual({ items: [] });

    try {
      await service.createForUser('u1', {
        riotGameName: 'InvisibleDuplicate',
        tagLine: 'KR1',
        region: 'kr',
      });
      throw new Error('Expected create to fail.');
    } catch (error) {
      expect(error).not.toBeInstanceOf(ConflictException);
    }

    await expect(service.listForUser('u1')).resolves.toEqual({ items: [] });
  });

  it('returns 409 through the DB unique fallback path when a same-user row appears after duplicate pre-check', async () => {
    const { service, prismaService, riotApiClient } = createService();
    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-race-same-user',
      gameName: 'RaceWinner',
      tagLine: 'KR1',
    });
    prismaService.riotAccount.create.mockImplementationOnce(async () => {
      prismaService.seedAccount({
        id: 'ra_race',
        userId: 'u1',
        riotGameName: 'RaceWinner',
        tagLine: 'KR1',
        region: 'kr',
        puuid: 'puuid-race-same-user',
        isPrimary: true,
      });
      throw createUniqueConstraintError();
    });

    const response = await expectConflict(
      service.createForUser('u1', {
        riotGameName: 'RaceWinner',
        tagLine: 'KR1',
        region: 'kr',
      }),
      'ALREADY_ADDED_BY_THIS_USER',
      'puuid_same_user',
    );

    expect(response).toMatchObject({
      details: {
        riotAccountId: 'ra_race',
        existingRiotAccountId: 'ra_race',
      },
    });
    await expect(service.listForUser('u1')).resolves.toMatchObject({
      items: [{ id: 'ra_race', riotGameName: 'RaceWinner', tagLine: 'KR1' }],
    });
  });

  it('reassigns primary correctly when a deleted Riot account is recreated as primary', async () => {
    const { service, prismaService, riotApiClient } = createService();
    prismaService.seedAccount({
      id: 'ra1',
      userId: 'u1',
      riotGameName: 'PrimaryOld',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'puuid-1',
      isPrimary: true,
      createdAt: new Date(1000),
    });
    prismaService.seedAccount({
      id: 'ra2',
      userId: 'u1',
      riotGameName: 'Secondary',
      tagLine: '0714',
      region: 'kr',
      puuid: 'puuid-2',
      isPrimary: false,
      createdAt: new Date(2000),
    });

    await service.deleteForUser('u1', 'ra1');
    expect(prismaService.state.accounts.find((account) => account.id === 'ra2')?.isPrimary).toBe(
      true,
    );

    riotApiClient.resolveAccountByRiotId.mockResolvedValue({
      puuid: 'puuid-1',
      gameName: 'PrimaryOld',
      tagLine: 'KR1',
    });

    const recreated = await service.createForUser('u1', {
      riotGameName: 'PrimaryOld',
      tagLine: 'KR1',
      region: 'kr',
      isPrimary: true,
    });

    expect(recreated.isPrimary).toBe(true);
    expect(prismaService.state.accounts.find((account) => account.id === 'ra2')?.isPrimary).toBe(
      false,
    );
    expect(
      prismaService.state.accounts.find((account) => account.id === recreated.id)?.isPrimary,
    ).toBe(true);
  });

  it('syncs shared Riot IDs independently per user-scoped riot account row', async () => {
    const { service, prismaService, riotApiClient, queueService } = createService();
    prismaService.seedAccount({
      id: 'ra_shared_u1',
      userId: 'u1',
      riotGameName: 'Shared',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'shared-puuid',
      isPrimary: true,
      syncStatus: RiotSyncStatus.QUEUED,
    });
    prismaService.seedAccount({
      id: 'ra_shared_u2',
      userId: 'u2',
      riotGameName: 'Shared',
      tagLine: 'KR1',
      region: 'kr',
      puuid: 'shared-puuid',
      isPrimary: true,
      syncStatus: RiotSyncStatus.IDLE,
    });
    riotApiClient.getSummonerByPuuid.mockResolvedValue({
      puuid: 'shared-puuid',
      encryptedSummonerId: 'summoner-shared',
      encryptedSummonerIdSourceField: 'id',
      profileIconId: 88,
      summonerLevel: 199,
      revisionDate: new Date('2026-04-16T01:00:00.000Z'),
      rawResponse: {
        id: 'summoner-shared',
        puuid: 'shared-puuid',
        profileIconId: 88,
        revisionDate: 1713229200000,
        summonerLevel: 199,
      },
    });
    riotApiClient.getRankedEntriesByPuuid.mockResolvedValue([
      {
        queueType: 'RANKED_SOLO_5x5',
        tier: 'PLATINUM',
        rank: 'IV',
        leaguePoints: 10,
        wins: 20,
        losses: 16,
      },
    ]);
    riotApiClient.getRecentMatchIds.mockResolvedValue(['match-shared-1']);
    riotApiClient.getMatchDetail.mockResolvedValue({
      info: {
        participants: [
          {
            puuid: 'shared-puuid',
            win: true,
            kills: 7,
            deaths: 2,
            assists: 9,
            visionScore: 25,
            individualPosition: 'MID',
            challenges: {
              killParticipation: 0.62,
              goldPerMinute: 430,
            },
          },
        ],
      },
    });

    await service.syncAccount('ra_shared_u1');

    expect(
      prismaService.state.accounts.find((account) => account.id === 'ra_shared_u1')?.syncStatus,
    ).toBe(RiotSyncStatus.SUCCEEDED);
    expect(
      prismaService.state.accounts.find((account) => account.id === 'ra_shared_u2')?.syncStatus,
    ).toBe(RiotSyncStatus.IDLE);
    expect(prismaService.state.snapshots).toHaveLength(2);
    expect(prismaService.state.snapshots.every((snapshot) => snapshot.riotAccountId === 'ra_shared_u1')).toBe(
      true,
    );
    expect(queueService.enqueuePowerRecalculation).toHaveBeenCalledWith('u1', 'riot-sync');
    expect(queueService.enqueuePowerRecalculation).not.toHaveBeenCalledWith('u2', 'riot-sync');
  });
});
