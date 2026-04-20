import { RiotChampionSummaryService } from '../src/riot/riot-champion-summary.service';

describe('RiotChampionSummaryService', () => {
  const prismaService = {
    riotAccount: {
      findFirst: jest.fn(),
    },
  } as any;
  const riotMatchHistoryRepository = {
    findChampionHistoryByPuuid: jest.fn(),
    getChampionHistoryDiagnosticsByPuuid: jest.fn(),
  } as any;

  let service: RiotChampionSummaryService;
  let matchCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    matchCounter = 0;
    service = new RiotChampionSummaryService(
      prismaService,
      riotMatchHistoryRepository,
    );
  });

  function historyRow(overrides: Partial<{
    riotMatchId: string;
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
  }> = {}) {
    return {
      riotMatchId: overrides.riotMatchId ?? `match-${++matchCounter}`,
      queueCategory: overrides.queueCategory ?? 'RANKED_SOLO',
      championId: overrides.championId !== undefined ? overrides.championId : 1,
      championKey: overrides.championKey !== undefined ? overrides.championKey : 'Aatrox',
      championName: overrides.championName !== undefined ? overrides.championName : 'Aatrox',
      kills: overrides.kills ?? 5,
      deaths: overrides.deaths ?? 2,
      assists: overrides.assists ?? 7,
      didWin: overrides.didWin ?? true,
      playedAt: overrides.playedAt ?? new Date('2026-04-20T00:00:00.000Z'),
      seasonKey: overrides.seasonKey ?? '2026',
    };
  }

  function mockHistory(rows: ReturnType<typeof historyRow>[]) {
    riotMatchHistoryRepository.findChampionHistoryByPuuid.mockResolvedValue(rows);
    riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid.mockResolvedValue(
      buildDiagnostics(rows),
    );
  }

  function buildDiagnostics(rows: ReturnType<typeof historyRow>[]) {
    const queueCounts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.queueCategory] = (acc[row.queueCategory] ?? 0) + 1;
      return acc;
    }, {});
    const ignoredMatches = rows.filter((row) => row.queueCategory === 'IGNORED').length;
    const rankedMatches = rows.filter((row) =>
      ['RANKED_SOLO', 'RANKED_FLEX'].includes(row.queueCategory),
    ).length;
    const mappedMatches = rows.filter(
      (row) => row.championId !== null || row.championKey !== null || row.championName !== null,
    ).length;
    const rankedMappedMatches = rows.filter(
      (row) =>
        ['RANKED_SOLO', 'RANKED_FLEX'].includes(row.queueCategory) &&
        (row.championId !== null || row.championKey !== null || row.championName !== null),
    ).length;
    const eligibleMappedMatches = rows.filter(
      (row) =>
        row.queueCategory !== 'IGNORED' &&
        (row.championId !== null || row.championKey !== null || row.championName !== null),
    ).length;

    return {
      totalMatches: rows.length,
      rankedMatches,
      eligibleMatches: rows.length - ignoredMatches,
      ignoredMatches,
      mappedMatches,
      rankedMappedMatches,
      eligibleMappedMatches,
      mappingFailureMatches: rows.length - mappedMatches,
      queueCounts,
    };
  }

  function account(overrides: Partial<{
    id: string;
    puuid: string;
    lastSyncedAt: Date | null;
    processedMatchCount: number;
    queuedMatchCount: number;
    hasUsableSnapshot: boolean;
    matchHistoryNextStart: number;
    matchHistoryComplete: boolean;
  }> = {}) {
    return {
      id: overrides.id ?? 'ra1',
      puuid: overrides.puuid ?? 'puuid-1',
      lastSyncedAt: overrides.lastSyncedAt ?? new Date('2026-04-20T00:00:00.000Z'),
      processedMatchCount: overrides.processedMatchCount ?? 0,
      queuedMatchCount: overrides.queuedMatchCount ?? 0,
      hasUsableSnapshot: overrides.hasUsableSnapshot ?? true,
      matchHistoryNextStart: overrides.matchHistoryNextStart ?? 0,
      matchHistoryComplete: overrides.matchHistoryComplete ?? true,
    };
  }

  it('aggregates across all stored seasons and ranks by games first', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue({ id: 'ra1', puuid: 'puuid-1' });
    mockHistory([
      historyRow({ championId: 1, championKey: 'Aatrox', seasonKey: '2026' }),
      historyRow({ championId: 1, championKey: 'Aatrox', seasonKey: '2025', didWin: false }),
      historyRow({ championId: 1, championKey: 'Aatrox', seasonKey: '2025' }),
      historyRow({ championId: 2, championKey: 'Ahri', championName: 'Ahri', seasonKey: '2026' }),
      historyRow({ championId: 2, championKey: 'Ahri', championName: 'Ahri', seasonKey: '2026' }),
      historyRow({ championId: 3, championKey: 'Ashe', championName: 'Ashe', seasonKey: '2026', didWin: false }),
      historyRow({ championId: 3, championKey: 'Ashe', championName: 'Ashe', seasonKey: '2025' }),
      historyRow({ championId: 3, championKey: 'Ashe', championName: 'Ashe', seasonKey: '2025' }),
    ]);

    const result = await service.getTopChampionsForUser('user-1');

    expect(result.map((item) => item.championKey)).toEqual(['Aatrox', 'Ashe', 'Ahri']);
    expect(result[0]).toMatchObject({
      games: 3,
      wins: 2,
      losses: 1,
    });
  });

  it('keeps previous-season heavy champions when the current season sample is small', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue({ id: 'ra1', puuid: 'puuid-1' });
    mockHistory([
      historyRow({ championId: 11, championKey: 'LeeSin', championName: 'Lee Sin', seasonKey: '2024' }),
      historyRow({ championId: 11, championKey: 'LeeSin', championName: 'Lee Sin', seasonKey: '2024' }),
      historyRow({ championId: 11, championKey: 'LeeSin', championName: 'Lee Sin', seasonKey: '2024' }),
      historyRow({ championId: 11, championKey: 'LeeSin', championName: 'Lee Sin', seasonKey: '2024' }),
      historyRow({ championId: 11, championKey: 'LeeSin', championName: 'Lee Sin', seasonKey: '2024' }),
      historyRow({ championId: 222, championKey: 'Jinx', championName: 'Jinx', seasonKey: '2026' }),
    ]);

    const result = await service.getTopChampionsForUser('user-1');

    expect(result[0]).toMatchObject({
      championKey: 'LeeSin',
      games: 5,
    });
  });

  it('fills remaining slots with sub-threshold champions when fewer than three meet the minimum games', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue({ id: 'ra1', puuid: 'puuid-1' });
    mockHistory([
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 11, championKey: 'MasterYi', championName: 'Master Yi' }),
      historyRow({ championId: 12, championKey: 'Lux', championName: 'Lux', didWin: false }),
    ]);

    const result = await service.getTopChampionsForUser('user-1');

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.championKey)).toEqual(['Kayle', 'MasterYi', 'Lux']);
  });

  it('returns an empty array when no Riot account is connected', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(null);

    await expect(service.getTopChampionsForUser('user-1')).resolves.toEqual([]);
    expect(riotMatchHistoryRepository.findChampionHistoryByPuuid).not.toHaveBeenCalled();
  });

  it('returns only the stored portion safely when historical rows are partial', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue({ id: 'ra1', puuid: 'puuid-1' });
    mockHistory([
      historyRow({
        championId: null,
        championKey: null,
        championName: 'K_Sante',
        kills: 8,
        deaths: 0,
        assists: 5,
      }),
      historyRow({
        championId: null,
        championKey: null,
        championName: 'K_Sante',
        kills: 4,
        deaths: 0,
        assists: 9,
      }),
    ]);

    const result = await service.getTopChampionsForUser('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        championKey: 'KSante',
        championName: 'K_Sante',
        kda: 26,
      }),
    ]);
  });

  it('reads diagnostics and participant history once per request', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue({ id: 'ra1', puuid: 'puuid-1' });
    mockHistory([
      historyRow(),
      historyRow({ championId: 2, championKey: 'Ahri', championName: 'Ahri' }),
      historyRow({ championId: 2, championKey: 'Ahri', championName: 'Ahri', didWin: false }),
    ]);

    await service.getTopChampionsForUser('user-1');

    expect(riotMatchHistoryRepository.findChampionHistoryByPuuid).toHaveBeenCalledTimes(1);
    expect(
      riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid,
    ).toHaveBeenCalledTimes(1);
  });

  it('returns aggregation status for a normal ranked champion summary', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(account({ matchHistoryComplete: true }));
    mockHistory([
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
    ]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions).toHaveLength(1);
    expect(result.aggregationStatus).toMatchObject({
      status: 'READY',
      reason: 'none',
      hasUsableContent: true,
      totalMatches: 3,
      rankedMatches: 3,
      thresholdUsed: 3,
    });
  });

  it('reports the threshold fallback used when only two-game samples exist', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(account({ matchHistoryComplete: true }));
    mockHistory([
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 11, championKey: 'MasterYi', championName: 'Master Yi' }),
    ]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions.map((item) => item.championKey)).toEqual([
      'Kayle',
      'MasterYi',
    ]);
    expect(result.aggregationStatus.thresholdUsed).toBe(2);
    expect(result.aggregationStatus).toMatchObject({
      status: 'PARTIAL',
      reason: 'insufficient_sample',
      hasUsableContent: true,
    });
  });

  it('distinguishes no champion sync rows from a real empty champion pool', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(
      account({
        lastSyncedAt: new Date('2026-04-16T00:00:00.000Z'),
        processedMatchCount: 0,
        queuedMatchCount: 0,
        hasUsableSnapshot: false,
        matchHistoryNextStart: 0,
        matchHistoryComplete: false,
      }),
    );
    riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid.mockResolvedValue(
      buildDiagnostics([]),
    );

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions).toEqual([]);
    expect(result.aggregationStatus.reason).toBe('no_sync');
    expect(riotMatchHistoryRepository.findChampionHistoryByPuuid).not.toHaveBeenCalled();
  });

  it('reports insufficient backfill when sync coverage is partial and no summaries are usable yet', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(
      account({
        processedMatchCount: 25,
        queuedMatchCount: 25,
        matchHistoryNextStart: 25,
        matchHistoryComplete: false,
      }),
    );
    riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid.mockResolvedValue(
      buildDiagnostics([]),
    );

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.aggregationStatus).toMatchObject({
      status: 'EMPTY',
      reason: 'insufficient_backfill',
    });
  });

  it('keeps non-empty top champions usable when coverage is partial', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(
      account({
        processedMatchCount: 20,
        queuedMatchCount: 20,
        matchHistoryNextStart: 20,
        matchHistoryComplete: false,
      }),
    );
    mockHistory([
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
      historyRow({ championId: 99, championKey: 'Lux', championName: 'Lux' }),
    ]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions).toHaveLength(1);
    expect(result.aggregationStatus).toMatchObject({
      status: 'PARTIAL',
      reason: 'insufficient_backfill',
      hasUsableContent: true,
    });
    expect(result.aggregationStatus.syncCoverageSummary).toMatchObject({
      needsBackfill: true,
      backfillSignal: 'REQUEST_SYNC_BACKFILL',
    });
  });

  it('does not misclassify limited champion samples as backfill gaps when sync coverage is complete', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(
      account({
        processedMatchCount: 3,
        queuedMatchCount: 3,
        matchHistoryNextStart: 3,
        matchHistoryComplete: true,
      }),
    );
    mockHistory([
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 10, championKey: 'Kayle', championName: 'Kayle' }),
      historyRow({ championId: 11, championKey: 'MasterYi', championName: 'Master Yi' }),
    ]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions).toHaveLength(2);
    expect(result.aggregationStatus).toMatchObject({
      status: 'PARTIAL',
      reason: 'insufficient_sample',
      hasUsableContent: true,
    });
  });

  it('reports all_filtered when stored rows are excluded by queue filters', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(account());
    riotMatchHistoryRepository.getChampionHistoryDiagnosticsByPuuid.mockResolvedValue(
      buildDiagnostics([
        historyRow({ queueCategory: 'IGNORED', championId: 1, championKey: 'Aatrox' }),
      ]),
    );
    riotMatchHistoryRepository.findChampionHistoryByPuuid.mockResolvedValue([]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.aggregationStatus.reason).toBe('all_filtered');
  });

  it('reports mapping_failure when raw rows cannot be grouped by champion', async () => {
    prismaService.riotAccount.findFirst.mockResolvedValue(account());
    mockHistory([
      historyRow({ championId: null, championKey: null, championName: null }),
      historyRow({ championId: null, championKey: null, championName: null }),
    ]);

    const result = await service.getTopChampionSummaryForUser('user-1');

    expect(result.topChampions).toEqual([]);
    expect(result.aggregationStatus.reason).toBe('mapping_failure');
  });
});
