import { of } from 'rxjs';

import { RiotApiClient } from '../src/riot/riot-api.client';

describe('RiotApiClient', () => {
  const createClient = () => {
    const httpService = {
      request: jest.fn(),
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'RIOT_ACCOUNT_REGION':
            return 'asia';
          case 'RIOT_PLATFORM_REGION':
            return 'kr';
          case 'RIOT_API_KEY':
            return 'test-riot-key';
          default:
            throw new Error(`Unexpected config key ${key}`);
        }
      }),
    };

    return {
      httpService,
      client: new RiotApiClient(httpService as any, configService as any),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps the by-puuid response id field to encryptedSummonerId', async () => {
    const { client, httpService } = createClient();
    const rawResponse = {
      id: 'encrypted-summoner-id',
      puuid: 'puuid-1',
      profileIconId: 123,
      revisionDate: 1713096000000,
      summonerLevel: 77,
    };
    httpService.request.mockReturnValue(
      of({
        status: 200,
        data: rawResponse,
      }),
    );

    await expect(client.getSummonerByPuuid('puuid-1', 'kr')).resolves.toEqual({
      encryptedSummonerId: 'encrypted-summoner-id',
      encryptedSummonerIdSourceField: 'id',
      puuid: 'puuid-1',
      profileIconId: 123,
      revisionDate: new Date(1713096000000),
      summonerLevel: 77,
      rawResponse,
    });
  });

  it('falls back to summonerId when id is absent in the raw response', async () => {
    const { client, httpService } = createClient();
    const rawResponse = {
      summonerId: 'fallback-summoner-id',
      puuid: 'puuid-2',
      profileIconId: 456,
      revisionDate: 1713099600000,
      summonerLevel: 88,
    };
    httpService.request.mockReturnValue(
      of({
        status: 200,
        data: rawResponse,
      }),
    );

    await expect(client.getSummonerByPuuid('puuid-2', 'kr')).resolves.toEqual({
      encryptedSummonerId: 'fallback-summoner-id',
      encryptedSummonerIdSourceField: 'summonerId',
      puuid: 'puuid-2',
      profileIconId: 456,
      revisionDate: new Date(1713099600000),
      summonerLevel: 88,
      rawResponse,
    });
  });

  it('reports none when the raw response omits encrypted summoner id fields', async () => {
    const { client, httpService } = createClient();
    const rawResponse = {
      puuid: 'puuid-3',
      profileIconId: 789,
      revisionDate: 1713103200000,
      summonerLevel: 99,
    };
    httpService.request.mockReturnValue(
      of({
        status: 200,
        data: rawResponse,
      }),
    );

    await expect(client.getSummonerByPuuid('puuid-3', 'kr')).resolves.toEqual({
      encryptedSummonerId: null,
      encryptedSummonerIdSourceField: 'none',
      puuid: 'puuid-3',
      profileIconId: 789,
      revisionDate: new Date(1713103200000),
      summonerLevel: 99,
      rawResponse,
    });
  });

  it('does not write raw Riot response values to debug logs', async () => {
    const { client, httpService } = createClient();
    const sentinel = 'riot-response-private-sentinel';
    const debugSpy = jest
      .spyOn((client as any).logger, 'debug')
      .mockImplementation(() => undefined);

    httpService.request.mockReturnValue(
      of({
        status: 200,
        data: {
          id: 'encrypted-summoner-id',
          puuid: 'puuid-1',
          privateValue: sentinel,
        },
      }),
    );

    await client.getSummonerByPuuid('puuid-1', 'kr');

    expect(debugSpy.mock.calls.flat().join('\n')).not.toContain(sentinel);
  });
});
