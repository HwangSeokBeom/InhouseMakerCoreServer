import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BalanceMode,
  MatchStatus,
  ParticipationStatus,
  Position,
  TeamSide,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class MatchPlayerInputDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  riotAccountId?: string;

  @ApiPropertyOptional({ enum: ParticipationStatus, default: ParticipationStatus.ACCEPTED })
  @IsOptional()
  @IsEnum(ParticipationStatus)
  participationStatus?: ParticipationStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sameTeamPreferenceUserIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avoidTeamPreferenceUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCaptain?: boolean;
}

export class AddMatchPlayersDto {
  @ApiProperty({ type: [MatchPlayerInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchPlayerInputDto)
  players!: MatchPlayerInputDto[];
}

class MatchPlayerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: TeamSide, required: false, nullable: true })
  teamSide!: TeamSide | null;

  @ApiProperty({ enum: Position, required: false, nullable: true })
  assignedRole!: Position | null;

  @ApiProperty({ enum: ParticipationStatus })
  participationStatus!: ParticipationStatus;

  @ApiProperty()
  isCaptain!: boolean;
}

export class MatchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  groupId!: string;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiPropertyOptional()
  scheduledAt!: string | null;

  @ApiProperty({ enum: BalanceMode, nullable: true, required: false })
  balanceMode!: BalanceMode | null;

  @ApiPropertyOptional()
  selectedCandidateNo!: number | null;

  @ApiProperty({ type: [MatchPlayerResponseDto] })
  players!: MatchPlayerResponseDto[];

  @ApiPropertyOptional({ type: Object })
  candidates!: unknown;
}

