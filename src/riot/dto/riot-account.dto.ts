import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RiotSyncStatus, VerificationStatus } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateRiotAccountDto {
  @ApiProperty({
    description:
      'Riot game name. You may also send the combined Riot ID here in the form gameName#tagLine.',
  })
  @IsString()
  @MaxLength(64)
  riotGameName!: string;

  @ApiPropertyOptional({
    description:
      'Riot tagLine without the leading #. Optional when riotGameName already includes gameName#tagLine.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 8)
  tagLine?: string;

  @ApiPropertyOptional({
    description:
      'LoL platform region such as kr, na1, euw1. This is not the Riot tagLine. Defaults to the server platform region when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  region?: string;

  @ApiPropertyOptional({
    description:
      'Whether this Riot ID should be used as the current user’s in-app primary calculation account.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class RiotAccountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  riotGameName!: string;

  @ApiProperty()
  tagLine!: string;

  @ApiProperty()
  region!: string;

  @ApiProperty()
  platformRegion!: string;

  @ApiProperty()
  accountRegion!: string;

  @ApiProperty()
  puuid!: string;

  @ApiPropertyOptional()
  profileIconId!: number | null;

  @ApiPropertyOptional()
  summonerLevel!: number | null;

  @ApiPropertyOptional()
  summonerRevisionDate!: string | null;

  @ApiProperty({
    description:
      'Whether this Riot ID is the current user’s in-app primary calculation account.',
  })
  isPrimary!: boolean;

  @ApiProperty({ enum: VerificationStatus })
  verificationStatus!: VerificationStatus;

  @ApiProperty({ enum: RiotSyncStatus })
  syncStatus!: RiotSyncStatus;

  @ApiPropertyOptional()
  lastSyncRequestedAt!: string | null;

  @ApiPropertyOptional()
  lastSyncSucceededAt!: string | null;

  @ApiPropertyOptional()
  lastSyncFailedAt!: string | null;

  @ApiPropertyOptional()
  lastSyncErrorCode!: string | null;

  @ApiPropertyOptional()
  lastSyncErrorMessage!: string | null;

  @ApiPropertyOptional()
  lastSyncWarningCode!: string | null;

  @ApiPropertyOptional()
  lastSyncWarningMessage!: string | null;

  @ApiPropertyOptional()
  lastSyncedAt!: string | null;
}

export class RiotAccountListResponseDto {
  @ApiProperty({ type: [RiotAccountResponseDto] })
  items!: RiotAccountResponseDto[];
}

export class RiotAccountSyncAcceptedDto {
  @ApiProperty()
  riotAccountId!: string;

  @ApiProperty()
  queued!: boolean;

  @ApiProperty({ enum: RiotSyncStatus })
  syncStatus!: RiotSyncStatus;

  @ApiPropertyOptional()
  lastSyncRequestedAt!: string | null;
}

export class RiotAccountSyncStatusResponseDto {
  @ApiProperty()
  riotAccountId!: string;

  @ApiProperty({ enum: RiotSyncStatus })
  syncStatus!: RiotSyncStatus;

  @ApiPropertyOptional()
  lastSyncRequestedAt!: string | null;

  @ApiPropertyOptional()
  lastSyncSucceededAt!: string | null;

  @ApiPropertyOptional()
  lastSyncFailedAt!: string | null;

  @ApiPropertyOptional()
  lastSyncErrorCode!: string | null;

  @ApiPropertyOptional()
  lastSyncErrorMessage!: string | null;

  @ApiPropertyOptional()
  lastSyncWarningCode!: string | null;

  @ApiPropertyOptional()
  lastSyncWarningMessage!: string | null;

  @ApiPropertyOptional()
  profileIconId!: number | null;

  @ApiPropertyOptional()
  summonerLevel!: number | null;

  @ApiPropertyOptional()
  summonerRevisionDate!: string | null;

  @ApiPropertyOptional()
  lastSyncedAt!: string | null;

  @ApiPropertyOptional()
  processedMatchCount!: number | null;

  @ApiPropertyOptional()
  queuedMatchCount!: number | null;

  @ApiPropertyOptional()
  estimatedRemaining!: number | null;

  @ApiPropertyOptional()
  lastProgressAt!: string | null;

  @ApiPropertyOptional()
  phase!: string | null;

  @ApiPropertyOptional()
  isInitialSync!: boolean;

  @ApiPropertyOptional()
  hasUsableSnapshot!: boolean;
}

export class RiotAccountDeleteResponseDto {
  @ApiProperty()
  deletedRiotAccountId!: string;

  @ApiProperty()
  deletedWasPrimary!: boolean;

  @ApiPropertyOptional()
  nextPrimaryRiotAccountId!: string | null;

  @ApiProperty()
  removedQueuedSyncJobs!: number;

  @ApiProperty({ type: [RiotAccountResponseDto] })
  items!: RiotAccountResponseDto[];
}
