import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
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

interface RiotSummonerResponse {
  id: string;
  puuid: string;
}

interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
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
  ): Promise<RiotAccountLookupResponse> {
    return this.request<RiotAccountLookupResponse>({
      method: 'GET',
      url: this.buildAccountUrl(
        `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotGameName)}/${encodeURIComponent(tagLine)}`,
      ),
    });
  }

  getSummonerByPuuid(puuid: string): Promise<RiotSummonerResponse> {
    return this.request<RiotSummonerResponse>({
      method: 'GET',
      url: this.buildPlatformUrl(`/lol/summoner/v4/summoners/by-puuid/${puuid}`),
    });
  }

  getRankedEntries(summonerId: string): Promise<RiotLeagueEntry[]> {
    return this.request<RiotLeagueEntry[]>({
      method: 'GET',
      url: this.buildPlatformUrl(`/lol/league/v4/entries/by-summoner/${summonerId}`),
    });
  }

  getRecentMatchIds(puuid: string, count = 20): Promise<string[]> {
    return this.request<string[]>({
      method: 'GET',
      url: this.buildAccountUrl(`/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`),
    });
  }

  getMatchDetail(matchId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'GET',
      url: this.buildAccountUrl(`/lol/match/v5/matches/${matchId}`),
    });
  }

  private buildAccountUrl(path: string): string {
    return `https://${this.accountRegion}.api.riotgames.com${path}`;
  }

  private buildPlatformUrl(path: string): string {
    return `https://${this.platformRegion}.api.riotgames.com${path}`;
  }

  private async request<T>(config: AxiosRequestConfig, attempt = 1): Promise<T> {
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
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;

      if (status === 429 && attempt <= 3) {
        const retryAfterSeconds = Number(axiosError.response?.headers['retry-after'] ?? 1);
        await this.delay(retryAfterSeconds * 1_000);
        return this.request<T>(config, attempt + 1);
      }

      if (status && status >= 500 && attempt <= 3) {
        await this.delay(500 * attempt);
        return this.request<T>(config, attempt + 1);
      }

      this.logger.warn(`Riot API request failed with status ${status ?? 'unknown'}`);

      if (status === 429) {
        throw new HttpException('Riot API rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
      }

      throw new ServiceUnavailableException('Riot API request failed.');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
