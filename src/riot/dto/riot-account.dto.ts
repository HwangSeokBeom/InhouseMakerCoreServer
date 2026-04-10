import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateRiotAccountDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  riotGameName!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 8)
  tagLine!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(8)
  region!: string;

  @ApiPropertyOptional()
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
  puuid!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ enum: VerificationStatus })
  verificationStatus!: VerificationStatus;

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
}

