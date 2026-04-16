import { LaneResult, Position, ResultStatus, TeamSide } from '@prisma/client';

import { InhouseMmrCalculator } from '../src/power/calculators/inhouse-mmr.calculator';
import { POWER_ROLES } from '../src/power/power.constants';

describe('InhouseMmrCalculator', () => {
  it('updates only the played role and applies confidence weights by result status', () => {
    const calculator = new InhouseMmrCalculator();
    const seedRoleMmr = POWER_ROLES.reduce<Record<string, number>>((acc, role) => {
      acc[role] = 1700;
      return acc;
    }, {});

    const buildPlayers = (enemyPower: number) => [
      {
        userId: 'u1',
        teamSide: TeamSide.A,
        assignedRole: Position.TOP,
        user: { powerProfile: { overallPower: 70, lanePowerJson: { TOP: 70 } } },
      },
      {
        userId: 'u2',
        teamSide: TeamSide.A,
        assignedRole: Position.JUNGLE,
        user: { powerProfile: { overallPower: 66, lanePowerJson: { JUNGLE: 66 } } },
      },
      {
        userId: 'u3',
        teamSide: TeamSide.A,
        assignedRole: Position.MID,
        user: { powerProfile: { overallPower: 65, lanePowerJson: { MID: 65 } } },
      },
      {
        userId: 'u4',
        teamSide: TeamSide.A,
        assignedRole: Position.ADC,
        user: { powerProfile: { overallPower: 64, lanePowerJson: { ADC: 64 } } },
      },
      {
        userId: 'u5',
        teamSide: TeamSide.A,
        assignedRole: Position.SUPPORT,
        user: { powerProfile: { overallPower: 63, lanePowerJson: { SUPPORT: 63 } } },
      },
      {
        userId: 'u6',
        teamSide: TeamSide.B,
        assignedRole: Position.TOP,
        user: { powerProfile: { overallPower: enemyPower, lanePowerJson: { TOP: enemyPower } } },
      },
      {
        userId: 'u7',
        teamSide: TeamSide.B,
        assignedRole: Position.JUNGLE,
        user: { powerProfile: { overallPower: enemyPower, lanePowerJson: { JUNGLE: enemyPower } } },
      },
      {
        userId: 'u8',
        teamSide: TeamSide.B,
        assignedRole: Position.MID,
        user: { powerProfile: { overallPower: enemyPower, lanePowerJson: { MID: enemyPower } } },
      },
      {
        userId: 'u9',
        teamSide: TeamSide.B,
        assignedRole: Position.ADC,
        user: { powerProfile: { overallPower: enemyPower, lanePowerJson: { ADC: enemyPower } } },
      },
      {
        userId: 'u10',
        teamSide: TeamSide.B,
        assignedRole: Position.SUPPORT,
        user: { powerProfile: { overallPower: enemyPower, lanePowerJson: { SUPPORT: enemyPower } } },
      },
    ];

    const confirmed = calculator.calculate({
      userId: 'u1',
      seedRoleMmr,
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
      stats: [
        {
          matchId: 'm1',
          userId: 'u1',
          role: Position.TOP,
          teamSide: TeamSide.A,
          laneResult: LaneResult.WIN,
          contributionRating: 4,
          statStatus: ResultStatus.CONFIRMED,
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          match: {
            players: buildPlayers(78),
            result: {
              winningTeam: TeamSide.A,
              balanceRating: 5,
              resultStatus: ResultStatus.CONFIRMED,
              confirmedAt: new Date('2026-04-01T01:00:00.000Z'),
              mvpUserId: 'u1',
            },
          },
        },
      ],
    });

    const partial = calculator.calculate({
      userId: 'u1',
      seedRoleMmr,
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
      stats: [
        {
          matchId: 'm2',
          userId: 'u1',
          role: Position.TOP,
          teamSide: TeamSide.A,
          laneResult: LaneResult.WIN,
          contributionRating: 4,
          statStatus: ResultStatus.PARTIAL,
          createdAt: new Date('2026-04-02T00:00:00.000Z'),
          match: {
            players: buildPlayers(78),
            result: {
              winningTeam: TeamSide.A,
              balanceRating: 5,
              resultStatus: ResultStatus.PARTIAL,
              confirmedAt: null,
              mvpUserId: 'u1',
            },
          },
        },
      ],
    });

    const disputed = calculator.calculate({
      userId: 'u1',
      seedRoleMmr,
      primaryPosition: Position.TOP,
      secondaryPosition: Position.JUNGLE,
      stats: [
        {
          matchId: 'm3',
          userId: 'u1',
          role: Position.TOP,
          teamSide: TeamSide.A,
          laneResult: LaneResult.WIN,
          contributionRating: 4,
          statStatus: ResultStatus.DISPUTED,
          createdAt: new Date('2026-04-03T00:00:00.000Z'),
          match: {
            players: buildPlayers(78),
            result: {
              winningTeam: TeamSide.A,
              balanceRating: 5,
              resultStatus: ResultStatus.DISPUTED,
              confirmedAt: null,
              mvpUserId: 'u1',
            },
          },
        },
      ],
    });

    expect(confirmed.roleMmr.TOP).toBeGreaterThan(seedRoleMmr.TOP);
    expect(confirmed.roleMmr.JUNGLE).toBe(seedRoleMmr.JUNGLE);
    expect(partial.roleMmr.TOP - seedRoleMmr.TOP).toBeLessThan(
      confirmed.roleMmr.TOP - seedRoleMmr.TOP,
    );
    expect(disputed.roleMmr.TOP).toBe(seedRoleMmr.TOP);
    expect(confirmed.confirmedMatchCount).toBe(1);
  });
});
