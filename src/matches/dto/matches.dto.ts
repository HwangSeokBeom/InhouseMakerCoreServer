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

export class UpdateMatchPlayerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  riotAccountId?: string;

  @ApiPropertyOptional({ enum: ParticipationStatus })
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

class MatchSummaryPlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: Position, nullable: true, required: false })
  assignedRole!: Position | null;

  @ApiProperty()
  currentPower!: number;

  @ApiPropertyOptional()
  kda!: string | null;

  @ApiPropertyOptional({ nullable: true })
  laneResult!: string | null;
}

export class MatchSummaryResponseDto {
  @ApiProperty()
  matchId!: string;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional()
  resultStatus!: string | null;

  @ApiPropertyOptional()
  mvpUserId!: string | null;

  @ApiPropertyOptional()
  balanceRating!: number | null;

  @ApiProperty()
  teamAPower!: number;

  @ApiProperty()
  teamBPower!: number;

  @ApiProperty({ type: [MatchSummaryPlayerDto] })
  teamA!: MatchSummaryPlayerDto[];

  @ApiProperty({ type: [MatchSummaryPlayerDto] })
  teamB!: MatchSummaryPlayerDto[];
}
