import { BalanceMode, Position } from '@prisma/client';

import { MatchmakingAlgorithmService } from '../src/matchmaking/matchmaking-algorithm.service';

describe('MatchmakingAlgorithmService', () => {
  it('generates three explainable candidates and keeps role coverage', () => {
    const service = new MatchmakingAlgorithmService();
    const players = [
      { userId: 'u1', nickname: 'Top1', primaryPosition: Position.TOP, secondaryPosition: Position.JUNGLE, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 74, JUNGLE: 65, MID: 58, ADC: 55, SUPPORT: 52 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u2', nickname: 'Jg1', primaryPosition: Position.JUNGLE, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 63, JUNGLE: 73, MID: 57, ADC: 53, SUPPORT: 54 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u3', nickname: 'Mid1', primaryPosition: Position.MID, secondaryPosition: Position.ADC, isFillAvailable: false, overallPower: 72, lanePower: { TOP: 55, JUNGLE: 58, MID: 78, ADC: 67, SUPPORT: 51 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u4', nickname: 'Ad1', primaryPosition: Position.ADC, secondaryPosition: Position.MID, isFillAvailable: false, overallPower: 71, lanePower: { TOP: 52, JUNGLE: 55, MID: 66, ADC: 77, SUPPORT: 50 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u5', nickname: 'Sup1', primaryPosition: Position.SUPPORT, secondaryPosition: Position.ADC, isFillAvailable: true, overallPower: 68, lanePower: { TOP: 50, JUNGLE: 54, MID: 56, ADC: 62, SUPPORT: 75 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u6', nickname: 'Top2', primaryPosition: Position.TOP, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 72, JUNGLE: 57, MID: 55, ADC: 54, SUPPORT: 61 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u7', nickname: 'Jg2', primaryPosition: Position.JUNGLE, secondaryPosition: Position.SUPPORT, isFillAvailable: true, overallPower: 67, lanePower: { TOP: 57, JUNGLE: 71, MID: 56, ADC: 55, SUPPORT: 63 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u8', nickname: 'Mid2', primaryPosition: Position.MID, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 61, JUNGLE: 56, MID: 74, ADC: 59, SUPPORT: 55 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u9', nickname: 'Ad2', primaryPosition: Position.ADC, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 68, lanePower: { TOP: 51, JUNGLE: 54, MID: 60, ADC: 73, SUPPORT: 64 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u10', nickname: 'Sup2', primaryPosition: Position.SUPPORT, secondaryPosition: Position.JUNGLE, isFillAvailable: true, overallPower: 66, lanePower: { TOP: 52, JUNGLE: 61, MID: 55, ADC: 58, SUPPORT: 72 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
    ];

    const candidates = service.generateCandidates(players);

    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.type)).toEqual([
      BalanceMode.BALANCED,
      BalanceMode.POSITION_FIRST,
      BalanceMode.SKILL_FIRST,
    ]);

    for (const candidate of candidates) {
      expect(candidate.teamA).toHaveLength(5);
      expect(candidate.teamB).toHaveLength(5);
      expect(new Set(candidate.teamA.map((player) => player.assignedRole))).toEqual(
        new Set([Position.TOP, Position.JUNGLE, Position.MID, Position.ADC, Position.SUPPORT]),
      );
    }
  });

  it('changes candidate score depending on selected mode weights', () => {
    const service = new MatchmakingAlgorithmService();
    const metrics = {
      teamPowerGap: 0.8,
      laneMatchupGap: 0.9,
      offRolePenalty: 2.4,
      repeatTeamPenalty: 0,
      preferenceViolationPenalty: 0.2,
      volatilityClusterPenalty: 0.1,
    };

    expect(service.scoreCandidate(metrics, BalanceMode.POSITION_FIRST)).toBeGreaterThan(
      service.scoreCandidate(metrics, BalanceMode.SKILL_FIRST),
    );
  });

  it('applies repeat team penalty when a recent duo is forced onto the same side again', () => {
    const service = new MatchmakingAlgorithmService();
    const players = [
      { userId: 'u1', nickname: 'Top1', primaryPosition: Position.TOP, secondaryPosition: Position.JUNGLE, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 74, JUNGLE: 65, MID: 58, ADC: 55, SUPPORT: 52 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [], lockedTeamSide: 'A' as const },
      { userId: 'u2', nickname: 'Jg1', primaryPosition: Position.JUNGLE, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 63, JUNGLE: 73, MID: 57, ADC: 53, SUPPORT: 54 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [], lockedTeamSide: 'A' as const },
      { userId: 'u3', nickname: 'Mid1', primaryPosition: Position.MID, secondaryPosition: Position.ADC, isFillAvailable: false, overallPower: 72, lanePower: { TOP: 55, JUNGLE: 58, MID: 78, ADC: 67, SUPPORT: 51 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u4', nickname: 'Ad1', primaryPosition: Position.ADC, secondaryPosition: Position.MID, isFillAvailable: false, overallPower: 71, lanePower: { TOP: 52, JUNGLE: 55, MID: 66, ADC: 77, SUPPORT: 50 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u5', nickname: 'Sup1', primaryPosition: Position.SUPPORT, secondaryPosition: Position.ADC, isFillAvailable: true, overallPower: 68, lanePower: { TOP: 50, JUNGLE: 54, MID: 56, ADC: 62, SUPPORT: 75 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u6', nickname: 'Top2', primaryPosition: Position.TOP, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 72, JUNGLE: 57, MID: 55, ADC: 54, SUPPORT: 61 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u7', nickname: 'Jg2', primaryPosition: Position.JUNGLE, secondaryPosition: Position.SUPPORT, isFillAvailable: true, overallPower: 67, lanePower: { TOP: 57, JUNGLE: 71, MID: 56, ADC: 55, SUPPORT: 63 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u8', nickname: 'Mid2', primaryPosition: Position.MID, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 61, JUNGLE: 56, MID: 74, ADC: 59, SUPPORT: 55 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u9', nickname: 'Ad2', primaryPosition: Position.ADC, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 68, lanePower: { TOP: 51, JUNGLE: 54, MID: 60, ADC: 73, SUPPORT: 64 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u10', nickname: 'Sup2', primaryPosition: Position.SUPPORT, secondaryPosition: Position.JUNGLE, isFillAvailable: true, overallPower: 66, lanePower: { TOP: 52, JUNGLE: 61, MID: 55, ADC: 58, SUPPORT: 72 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
    ];

    const candidates = service.generateCandidates(players, [], {
      recentWindowSize: 8,
      matchesAnalyzed: 3,
      sameTeamPairHistory: {
        'u1:u2': {
          userIds: ['u1', 'u2'],
          sameTeamMatches: 3,
          weightedSameTeamScore: 3.2,
          recentMatchIds: ['m3', 'm2', 'm1'],
        },
      },
    });

    expect(candidates[0].metrics.repeatTeamPenalty).toBeGreaterThan(0);
    expect(candidates[0].explanationDetails.repeatTeam.penalizedPairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userIds: ['u1', 'u2'],
          sameTeamMatches: 3,
        }),
      ]),
    );
  });

  it('keeps strategy candidates distinct when alternative combinations exist', () => {
    const service = new MatchmakingAlgorithmService();
    const players = [
      { userId: 'u1', nickname: 'Top1', primaryPosition: Position.TOP, secondaryPosition: Position.JUNGLE, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 74, JUNGLE: 65, MID: 58, ADC: 55, SUPPORT: 52 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u2', nickname: 'Jg1', primaryPosition: Position.JUNGLE, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 63, JUNGLE: 73, MID: 57, ADC: 53, SUPPORT: 54 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u3', nickname: 'Mid1', primaryPosition: Position.MID, secondaryPosition: Position.ADC, isFillAvailable: false, overallPower: 72, lanePower: { TOP: 55, JUNGLE: 58, MID: 78, ADC: 67, SUPPORT: 51 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u4', nickname: 'Ad1', primaryPosition: Position.ADC, secondaryPosition: Position.MID, isFillAvailable: false, overallPower: 71, lanePower: { TOP: 52, JUNGLE: 55, MID: 66, ADC: 77, SUPPORT: 50 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u5', nickname: 'Sup1', primaryPosition: Position.SUPPORT, secondaryPosition: Position.ADC, isFillAvailable: true, overallPower: 68, lanePower: { TOP: 50, JUNGLE: 54, MID: 56, ADC: 62, SUPPORT: 75 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u6', nickname: 'Top2', primaryPosition: Position.TOP, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 70, lanePower: { TOP: 72, JUNGLE: 57, MID: 55, ADC: 54, SUPPORT: 61 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u7', nickname: 'Jg2', primaryPosition: Position.JUNGLE, secondaryPosition: Position.SUPPORT, isFillAvailable: true, overallPower: 67, lanePower: { TOP: 57, JUNGLE: 71, MID: 56, ADC: 55, SUPPORT: 63 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u8', nickname: 'Mid2', primaryPosition: Position.MID, secondaryPosition: Position.TOP, isFillAvailable: false, overallPower: 69, lanePower: { TOP: 61, JUNGLE: 56, MID: 74, ADC: 59, SUPPORT: 55 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u9', nickname: 'Ad2', primaryPosition: Position.ADC, secondaryPosition: Position.SUPPORT, isFillAvailable: false, overallPower: 68, lanePower: { TOP: 51, JUNGLE: 54, MID: 60, ADC: 73, SUPPORT: 64 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
      { userId: 'u10', nickname: 'Sup2', primaryPosition: Position.SUPPORT, secondaryPosition: Position.JUNGLE, isFillAvailable: true, overallPower: 66, lanePower: { TOP: 52, JUNGLE: 61, MID: 55, ADC: 58, SUPPORT: 72 }, sameTeamPreferenceUserIds: [], avoidTeamPreferenceUserIds: [] },
    ];

    const candidates = service.generateCandidates(players);

    expect(new Set(candidates.map((candidate) => candidate.combinationKey)).size).toBe(
      candidates.length,
    );

    const rerolled = service.generateCandidates(
      players,
      [],
      undefined,
      {
        excludedCombinationKeys: [candidates[0].combinationKey],
        tiebreakSeed: 'reroll-1',
      },
    );

    expect(rerolled.some((candidate) => candidate.combinationKey === candidates[0].combinationKey)).toBe(false);
  });
});
