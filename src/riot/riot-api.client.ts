import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';

interface RiotAccountLookupResponse {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface RiotSummonerLookupRawResponse extends Record<string, unknown> {
  id?: unknown;
  puuid?: unknown;
  summonerId?: unknown;
  accountId?: unknown;
  profileIconId?: unknown;
  revisionDate?: unknown;
  summonerLevel?: unknown;
}

export interface RiotSummonerResponse {
  encryptedSummonerId: string | null;
  encryptedSummonerIdSourceField: 'id' | 'summonerId' | 'none';
  puuid: string;
  profileIconId: number | null;
  revisionDate: Date | null;
  summonerLevel: number | null;
  rawResponse: RiotSummonerLookupRawResponse;
}

interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

interface RiotRequestMetadata {
  stage:
    | 'account_lookup'
    | 'summoner_lookup'
    | 'league_lookup'
    | 'match_ids_lookup'
    | 'match_detail_lookup';
  riotGameName?: string;
  tagLine?: string;
  accountRegion?: string;
  platformRegion?: string;
  requestParams?: Record<string, unknown>;
}

export class RiotApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class RiotApiClient {
  private readonly logger = new Logger(RiotApiClient.name);
  private readonly accountRegion: string;
  private readonly platformRegion: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.accountRegion = this.configService.getOrThrow<string>('RIOT_ACCOUNT_REGION');
    this.platformRegion = this.configService.getOrThrow<string>('RIOT_PLATFORM_REGION');
    this.apiKey = this.configService.getOrThrow<string>('RIOT_API_KEY');
  }

  resolveAccountByRiotId(
    riotGameName: string,
    tagLine: string,
    accountRegion = this.accountRegion,
  ): Promise<RiotAccountLookupResponse> {
    return this.request<RiotAccountLookupResponse>(
      {
        method: 'GET',
        url: this.buildAccountUrl(
          accountRegion,
          `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
            riotGameName,
          )}/${encodeURIComponent(tagLine)}`,
        ),
      },
      {
        stage: 'account_lookup',
        riotGameName,
        tagLine,
        accountRegion,
      },
    );
  }

  getSummonerByPuuid(
    puuid: string,
    platformRegion = this.platformRegion,
  ): Promise<RiotSummonerResponse> {
    return this.request<RiotSummonerLookupRawResponse>(
      {
        method: 'GET',
        url: this.buildPlatformUrl(
          platformRegion,
          `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
        ),
      },
      {
        stage: 'summoner_lookup',
        platformRegion,
        requestParams: { puuid },
      },
    ).then((responseBody) => this.normalizeSummonerResponse(responseBody, puuid));
  }

  getRankedEntriesByPuuid(
    puuid: string,
    platformRegion = this.platformRegion,
  ): Promise<RiotLeagueEntry[]> {
    return this.request<RiotLeagueEntry[]>(
      {
        method: 'GET',
        url: this.buildPlatformUrl(
          platformRegion,
          `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
        ),
      },
      {
        stage: 'league_lookup',
        platformRegion,
        requestParams: { puuid, lookupKeyType: 'puuid' },
      },
    );
  }

  getRecentMatchIds(
    puuid: string,
    count = 20,
    start = 0,
    accountRegion = this.accountRegion,
  ): Promise<string[]> {
    return this.request<string[]>(
      {
        method: 'GET',
        url: this.buildAccountUrl(
          accountRegion,
          `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`,
        ),
        params: {
          start,
          count,
        },
      },
      {
        stage: 'match_ids_lookup',
        accountRegion,
        requestParams: { puuid, start, count },
      },
    );
  }

  getMatchDetail(
    matchId: string,
    accountRegion = this.accountRegion,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      {
        method: 'GET',
        url: this.buildAccountUrl(
          accountRegion,
          `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
        ),
      },
      {
        stage: 'match_detail_lookup',
        accountRegion,
      },
    );
  }

  private buildAccountUrl(accountRegion: string, path: string): string {
    return `https://${accountRegion}.api.riotgames.com${path}`;
  }

  private buildPlatformUrl(platformRegion: string, path: string): string {
    return `https://${platformRegion}.api.riotgames.com${path}`;
  }

  private async request<T>(
    config: AxiosRequestConfig,
    metadata: RiotRequestMetadata,
    attempt = 1,
  ): Promise<T> {
    const finalUrl = this.buildLogUrl(config.url, config.params);
    this.logger.debug(
      `[riot_api] request ${JSON.stringify({
        stage: metadata.stage,
        method: config.method ?? 'GET',
        finalUrl,
        riotGameName: metadata.riotGameName ?? null,
        tagLine: metadata.tagLine ?? null,
        accountRegion: metadata.accountRegion ?? null,
        platformRegion: metadata.platformRegion ?? null,
        requestParams: metadata.requestParams ?? config.params ?? null,
      })}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({
          timeout: 8_000,
          ...config,
          headers: {
            'X-Riot-Token': this.apiKey,
            ...(config.headers ?? {}),
          },
        }),
      );
      this.logger.debug(
        `[riot_api] response ${JSON.stringify(
          this.buildResponseLogPayload(
            metadata,
            config.method ?? 'GET',
            finalUrl,
            response.status,
            response.data,
          ),
        )}`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;

      if (status === 429 && attempt <= 3) {
        const retryAfterSeconds = Number(axiosError.response?.headers['retry-after'] ?? 1);
        await this.delay(retryAfterSeconds * 1_000);
        return this.request<T>(config, metadata, attempt + 1);
      }

      if (status && status >= 500 && attempt <= 3) {
        await this.delay(500 * attempt);
        return this.request<T>(config, metadata, attempt + 1);
      }

      this.logger.error(
        `[riot_api] failure ${JSON.stringify({
          stage: metadata.stage,
          method: config.method ?? 'GET',
          finalUrl,
          statusCode: status ?? null,
          riotGameName: metadata.riotGameName ?? null,
          tagLine: metadata.tagLine ?? null,
          accountRegion: metadata.accountRegion ?? null,
          platformRegion: metadata.platformRegion ?? null,
          requestParams: metadata.requestParams ?? config.params ?? null,
          upstreamResponseType: this.describeResponseType(axiosError.response?.data),
        })}`,
      );

      if (status === 429) {
        throw new RiotApiError(
          'Riot API rate limit exceeded.',
          'RIOT_RATE_LIMITED',
          HttpStatus.TOO_MANY_REQUESTS,
          true,
        );
      }

      if (status === 404) {
        throw new RiotApiError(
          'Riot resource was not found.',
          'RIOT_RESOURCE_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          false,
        );
      }

      if (status === 401 || status === 403) {
        throw new RiotApiError(
          'Riot API authentication failed.',
          'RIOT_AUTH_FAILED',
          status,
          false,
        );
      }

      if (status && status >= 500) {
        throw new RiotApiError(
          'Riot upstream service failed.',
          'RIOT_UPSTREAM_ERROR',
          status,
          true,
        );
      }

      if (status && status >= 400) {
        throw new RiotApiError(
          'Riot API request failed.',
          'RIOT_CLIENT_ERROR',
          status,
          false,
        );
      }

      throw new RiotApiError(
        'Riot API request failed.',
        'RIOT_NETWORK_ERROR',
        HttpStatus.SERVICE_UNAVAILABLE,
        true,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeSummonerResponse(
    rawResponse: RiotSummonerLookupRawResponse,
    requestedPuuid: string,
  ): RiotSummonerResponse {
    const directId = this.readString(rawResponse.id);
    const fallbackId = this.readString(rawResponse.summonerId);
    const encryptedSummonerId = directId ?? fallbackId;
    const encryptedSummonerIdSourceField = directId
      ? 'id'
      : fallbackId
        ? 'summonerId'
        : 'none';
    const responsePuuid = this.readString(rawResponse.puuid) ?? requestedPuuid;
    const profileIconId = this.readNumber(rawResponse.profileIconId);
    const revisionDate = this.readDateFromEpochMillis(rawResponse.revisionDate);
    const summonerLevel = this.readNumber(rawResponse.summonerLevel);

    this.logger.debug(
      `[riot_api] summoner_lookup_mapped ${JSON.stringify({
        requestedPuuid,
        responsePuuid,
        encryptedSummonerId,
        encryptedSummonerIdSourceField,
        profileIconId,
        revisionDate: revisionDate?.toISOString() ?? null,
        summonerLevel,
        rawFieldKeys: Object.keys(rawResponse),
      })}`,
    );

    return {
      encryptedSummonerId,
      encryptedSummonerIdSourceField,
      puuid: responsePuuid,
      profileIconId,
      revisionDate,
      summonerLevel,
      rawResponse,
    };
  }

  private buildLogUrl(
    baseUrl: string | undefined,
    params: AxiosRequestConfig['params'],
  ): string | null {
    if (!baseUrl) {
      return null;
    }

    if (!params || typeof params !== 'object') {
      return baseUrl;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      searchParams.set(key, String(value));
    }

    const query = searchParams.toString();
    return query ? `${baseUrl}?${query}` : baseUrl;
  }

  private buildResponseLogPayload(
    metadata: RiotRequestMetadata,
    method: string,
    finalUrl: string | null,
    statusCode: number,
    responseBody: unknown,
  ): Record<string, unknown> {
    const responseRecord =
      responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : null;
    const responseArray = Array.isArray(responseBody) ? responseBody : null;
    const requestPuuid = this.readString(metadata.requestParams?.puuid);
    const responsePuuid = this.readString(responseRecord?.puuid);
    const responseSummonerId =
      this.readString(responseRecord?.id) ?? this.readString(responseRecord?.summonerId);
    const requestSummonerId = this.readString(metadata.requestParams?.summonerId);

    return {
      stage: metadata.stage,
      method,
      finalUrl,
      statusCode,
      riotGameName: metadata.riotGameName ?? null,
      tagLine: metadata.tagLine ?? null,
      accountRegion: metadata.accountRegion ?? null,
      platformRegion: metadata.platformRegion ?? null,
      requestParams: metadata.requestParams ?? null,
      accountPuuid: responsePuuid ?? requestPuuid ?? null,
      summonerEncryptedId: responseSummonerId ?? null,
      leagueLookupRequestId:
        metadata.stage === 'league_lookup' ? requestSummonerId ?? null : null,
      leagueLookupRequestPuuid:
        metadata.stage === 'league_lookup' ? requestPuuid ?? null : null,
      rankedEntryCount:
        metadata.stage === 'league_lookup' && responseArray ? responseArray.length : null,
      upstreamResponseType: this.describeResponseType(responseBody),
    };
  }

  private describeResponseType(responseBody: unknown): string {
    if (Array.isArray(responseBody)) {
      return `array:${responseBody.length}`;
    }

    if (responseBody && typeof responseBody === 'object') {
      return 'object';
    }

    return responseBody === null || responseBody === undefined
      ? 'empty'
      : typeof responseBody;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  private readDateFromEpochMillis(value: unknown): Date | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
