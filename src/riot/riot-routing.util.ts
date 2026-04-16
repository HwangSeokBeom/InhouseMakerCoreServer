import { BadRequestException } from '@nestjs/common';

export interface ParsedRiotIdentifier {
  riotGameName: string;
  tagLine: string;
}

export interface ResolvedRiotRouting {
  platformRegion: string;
  accountRegion: string;
}

const PLATFORM_TO_ACCOUNT_REGION: Record<string, string> = {
  br1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  la1: 'americas',
  la2: 'americas',
  me1: 'europe',
  na1: 'americas',
  oc1: 'sea',
  ph2: 'sea',
  ru: 'europe',
  sg2: 'sea',
  th2: 'sea',
  tr1: 'europe',
  tw2: 'sea',
  vn2: 'sea',
};

const VALID_ACCOUNT_REGIONS = new Set(['americas', 'asia', 'europe', 'sea']);

export const parseRiotIdentifier = (input: {
  riotGameName?: string | null;
  tagLine?: string | null;
}): ParsedRiotIdentifier => {
  const rawGameName = input.riotGameName?.trim() ?? '';
  const rawTagLine = input.tagLine?.trim().replace(/^#/, '') ?? '';

  if (rawGameName.includes('#')) {
    const separatorIndex = rawGameName.lastIndexOf('#');
    const parsedGameName = rawGameName.slice(0, separatorIndex).trim();
    const parsedTagLine = rawGameName.slice(separatorIndex + 1).trim();

    if (!parsedGameName || !parsedTagLine || rawGameName.indexOf('#') !== separatorIndex) {
      throw new BadRequestException(
        'Riot ID must be formatted as gameName#tagLine.',
      );
    }

    if (rawTagLine && rawTagLine !== parsedTagLine) {
      throw new BadRequestException(
        'Riot ID tagLine does not match the provided tagLine field.',
      );
    }

    return validateParsedRiotIdentifier(parsedGameName, parsedTagLine);
  }

  if (!rawGameName || !rawTagLine) {
    throw new BadRequestException(
      'Riot ID must include both riotGameName and tagLine.',
    );
  }

  return validateParsedRiotIdentifier(rawGameName, rawTagLine);
};

export const resolveRiotRouting = (
  inputRegion: string | null | undefined,
  defaultPlatformRegion: string,
): ResolvedRiotRouting => {
  const platformRegion = (inputRegion?.trim() || defaultPlatformRegion).toLowerCase();
  const accountRegion = PLATFORM_TO_ACCOUNT_REGION[platformRegion];

  if (!accountRegion) {
    const allowedRegions = Object.keys(PLATFORM_TO_ACCOUNT_REGION).sort().join(', ');
    throw new BadRequestException(
      `Riot region must be a valid platform region. Supported values: ${allowedRegions}.`,
    );
  }

  return {
    platformRegion,
    accountRegion,
  };
};

export const isValidAccountRegion = (value: string): boolean => {
  return VALID_ACCOUNT_REGIONS.has(value.toLowerCase());
};

const validateParsedRiotIdentifier = (
  riotGameName: string,
  tagLine: string,
): ParsedRiotIdentifier => {
  if (riotGameName.length > 32 || tagLine.length < 2 || tagLine.length > 8) {
    throw new BadRequestException('Riot ID format is invalid.');
  }

  return {
    riotGameName,
    tagLine,
  };
};
