import { PowerService } from '../src/power/power.service';
import { POWER_PROFILE_VERSION } from '../src/power/power.constants';

describe('PowerService', () => {
  const prismaService = {
    playerPowerProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;
  const usersService = {
    assertCanAccessUserScopedResource: jest.fn(),
  } as any;

  let service: PowerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PowerService(
      prismaService,
      usersService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('recalculates stale profiles before returning the response', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique
      .mockResolvedValueOnce({
        userId: 'user-1',
        overallPower: 41.2,
        lanePowerJson: { MID: 41.2 },
        breakdownJson: {},
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 35,
        formScore: 50,
        inhouseMmr: 1500,
        inhouseConfidence: 0,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: null },
        version: 'v1',
        calculatedAt: new Date('2026-04-15T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        userId: 'user-1',
        overallPower: 76.25,
        lanePowerJson: { MID: 76.25 },
        breakdownJson: {
          inhouse: { inhouseWeight: 0.15 },
          displayScore: {
            sourceField: 'overallPower',
            dtoOverallPower: 76.25,
            clientDisplayRounded: 76,
          },
        },
        styleScoresJson: { stability: 52, carry: 54, teamContribution: 53, laneInfluence: 55 },
        basePower: 77.08,
        formScore: 52.1,
        inhouseMmr: 1762.5,
        inhouseConfidence: 0.15,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: null },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T10:00:00Z'),
      });
    const recalculateSpy = jest
      .spyOn(service, 'recalculateProfile')
      .mockResolvedValue(undefined);

    const response = await service.getProfile('viewer-1', 'user-1');

    expect(recalculateSpy).toHaveBeenCalledWith('user-1');
    expect(response.overallPower).toBe(76.25);
    expect(response.version).toBe(POWER_PROFILE_VERSION);
    expect((response.explanation.displayScore as Record<string, unknown>).sourceField).toBe(
      'overallPower',
    );
  });

  it('recalculates when riot sync is newer than stored calculation time', async () => {
    usersService.assertCanAccessUserScopedResource.mockResolvedValue(undefined);
    prismaService.playerPowerProfile.findUnique
      .mockResolvedValueOnce({
        userId: 'user-2',
        overallPower: 64.5,
        lanePowerJson: { MID: 64.5 },
        breakdownJson: { displayScore: { sourceField: 'overallPower' } },
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 60,
        formScore: 51,
        inhouseMmr: 1645,
        inhouseConfidence: 0.2,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: new Date('2026-04-16T11:00:00Z') },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        userId: 'user-2',
        overallPower: 68.4,
        lanePowerJson: { MID: 68.4 },
        breakdownJson: {
          inhouse: { inhouseWeight: 0.15 },
          displayScore: {
            sourceField: 'overallPower',
            dtoOverallPower: 68.4,
            clientDisplayRounded: 68,
          },
        },
        styleScoresJson: { stability: 50, carry: 50, teamContribution: 50, laneInfluence: 50 },
        basePower: 64,
        formScore: 51,
        inhouseMmr: 1684,
        inhouseConfidence: 0.2,
        user: { primaryPosition: 'MID', secondaryPosition: 'ADC' },
        sourceAccount: { lastSyncedAt: new Date('2026-04-16T11:00:00Z') },
        version: POWER_PROFILE_VERSION,
        calculatedAt: new Date('2026-04-16T11:00:05Z'),
      });
    const recalculateSpy = jest
      .spyOn(service, 'recalculateProfile')
      .mockResolvedValue(undefined);

    const response = await service.getProfile('viewer-1', 'user-2');

    expect(recalculateSpy).toHaveBeenCalledWith('user-2');
    expect(response.overallPower).toBe(68.4);
  });
});
