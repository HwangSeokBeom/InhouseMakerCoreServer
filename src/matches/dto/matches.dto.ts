import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BalanceMode,
  LaneResult,
  MatchStatus,
  ParticipationStatus,
  Position,
  ResultStatus,
  TeamSide,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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

export class RecentMatchesQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;
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

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  mainPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty({ nullable: true, required: false })
  recentPower!: number | null;

  @ApiProperty()
  profileVisible!: boolean;

  @ApiProperty({ enum: TeamSide, required: false, nullable: true })
  teamSide!: TeamSide | null;

  @ApiProperty({ enum: Position, required: false, nullable: true })
  assignedRole!: Position | null;

  @ApiProperty({ enum: ParticipationStatus })
  participationStatus!: ParticipationStatus;

  @ApiProperty()
  isCaptain!: boolean;

  @ApiPropertyOptional({ type: Object, nullable: true })
  resultStats!: MatchPlayerResultStatsDto | null;

  @ApiProperty({ type: Object, nullable: true, required: false })
  powerSnapshot!: MatchPlayerPowerSnapshotDto | null;

  @ApiProperty({ type: Object, nullable: true, required: false })
  powerChange!: MatchPlayerPowerChangeDto | null;
}

class MatchPlayerResultStatsDto {
  @ApiProperty()
  kills!: number;

  @ApiProperty()
  deaths!: number;

  @ApiProperty()
  assists!: number;

  @ApiProperty()
  kda!: string;

  @ApiProperty({ enum: LaneResult })
  laneResult!: LaneResult;

  @ApiPropertyOptional({ nullable: true })
  contributionRating!: number | null;
}

class MatchPlayerPowerSnapshotDto {
  @ApiProperty()
  overallPower!: number;

  @ApiProperty({ type: Object })
  lanePower!: Record<string, number>;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty()
  isFillAvailable!: boolean;

  @ApiPropertyOptional({ nullable: true })
  calculatedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  version!: string | null;

  @ApiProperty()
  source!: string;
}

class MatchPlayerPowerChangeDto {
  @ApiPropertyOptional({ nullable: true })
  before!: number | null;

  @ApiPropertyOptional({ nullable: true })
  after!: number | null;

  @ApiPropertyOptional({ nullable: true })
  delta!: number | null;

  @ApiProperty()
  available!: boolean;
}

class ManualBalanceMetadataDto {
  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty()
  updatedBy!: string;
}

class MatchTeamResponseDto {
  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  playerCount!: number;

  @ApiProperty()
  totalPower!: number;

  @ApiProperty({ type: [MatchPlayerResponseDto] })
  players!: MatchPlayerResponseDto[];
}

class MatchResultSummaryDto {
  @ApiProperty()
  resultId!: string;

  @ApiProperty({ enum: ResultStatus })
  resultStatus!: ResultStatus;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional()
  mvpUserId!: string | null;

  @ApiPropertyOptional()
  balanceRating!: number | null;

  @ApiPropertyOptional()
  balanceFeeling!: number | null;

  @ApiProperty()
  submittedBy!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional()
  confirmedAt!: string | null;

  @ApiPropertyOptional()
  adminResolvedAt!: string | null;

  @ApiProperty()
  playerStatsCount!: number;
}

class MatchResultInputPlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty({ enum: Position })
  assignedRole!: Position;
}

class MatchRematchPlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty()
  isFillAvailable!: boolean;

  @ApiProperty()
  overallPower!: number;

  @ApiProperty({ type: Object })
  lanePower!: Record<string, number>;

  @ApiPropertyOptional({ type: [String] })
  sameTeamPreferenceUserIds!: string[];

  @ApiPropertyOptional({ type: [String] })
  avoidTeamPreferenceUserIds!: string[];

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  lockedTeamSide!: TeamSide | null;

  @ApiProperty({ enum: Position, nullable: true, required: false })
  lockedRole!: Position | null;

  @ApiProperty({ type: MatchPlayerPowerSnapshotDto, nullable: true })
  powerSnapshot!: MatchPlayerPowerSnapshotDto | null;
}

class MatchRematchOptionsDto {
  @ApiProperty({ enum: BalanceMode, isArray: true })
  supportedStrategies!: BalanceMode[];

  @ApiProperty()
  excludePreviousCombinationSupported!: boolean;

  @ApiProperty()
  regenerateNonceSupported!: boolean;

  @ApiProperty()
  defaultExcludePreviousCombination!: boolean;

  @ApiProperty({ type: [String] })
  excludePreviousCombinationKeys!: string[];
}

export class MatchRematchInputResponseDto {
  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  canonicalMatchId!: string;

  @ApiProperty()
  groupId!: string;

  @ApiPropertyOptional()
  groupName!: string | null;

  @ApiProperty({ type: [MatchRematchPlayerDto] })
  players!: MatchRematchPlayerDto[];

  @ApiProperty({ type: MatchRematchOptionsDto })
  options!: MatchRematchOptionsDto;
}

export class MatchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  canonicalMatchId!: string;

  @ApiProperty()
  groupId!: string;

  @ApiPropertyOptional()
  groupName!: string | null;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiPropertyOptional()
  title!: string | null;

  @ApiPropertyOptional()
  notes!: string | null;

  @ApiPropertyOptional()
  scheduledAt!: string | null;

  @ApiPropertyOptional()
  playedAt!: string | null;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ enum: BalanceMode, nullable: true, required: false })
  balanceMode!: BalanceMode | null;

  @ApiPropertyOptional()
  selectedCandidateNo!: number | null;

  @ApiProperty({ type: [MatchPlayerResponseDto] })
  players!: MatchPlayerResponseDto[];

  @ApiProperty({ type: MatchTeamResponseDto, nullable: true })
  blueTeam!: MatchTeamResponseDto | null;

  @ApiProperty({ type: MatchTeamResponseDto, nullable: true })
  redTeam!: MatchTeamResponseDto | null;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional()
  resultStatus!: ResultStatus | null;

  @ApiPropertyOptional({ type: MatchResultSummaryDto, nullable: true })
  resultSummary!: MatchResultSummaryDto | null;

  @ApiPropertyOptional({ type: Object })
  candidates!: unknown;

  @ApiPropertyOptional({ type: ManualBalanceMetadataDto, nullable: true })
  manualBalance!: ManualBalanceMetadataDto | null;

  @ApiProperty({ type: MatchRematchInputResponseDto, nullable: true })
  rematchInput!: MatchRematchInputResponseDto | null;

  @ApiPropertyOptional()
  canSubmitResult?: boolean;

  @ApiPropertyOptional({ nullable: true })
  resultInputBlockedReason?: string | null;

  @ApiPropertyOptional({ type: [MatchResultInputPlayerDto] })
  mvpCandidates?: MatchResultInputPlayerDto[];

  @ApiPropertyOptional({ type: [MatchResultInputPlayerDto] })
  laneResultTargets?: MatchResultInputPlayerDto[];
}

class MatchSummaryPlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  mainPosition!: Position | null;

  @ApiProperty({ nullable: true, required: false })
  recentPower!: number | null;

  @ApiProperty()
  profileVisible!: boolean;

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
  id!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  canonicalMatchId!: string;

  @ApiProperty()
  groupId!: string;

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

class RecentMatchItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  canonicalMatchId!: string;

  @ApiProperty()
  groupId!: string;

  @ApiPropertyOptional()
  groupName!: string | null;

  @ApiPropertyOptional()
  title!: string | null;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiPropertyOptional()
  scheduledAt!: string | null;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional({ nullable: true })
  resultStatus!: string | null;

  @ApiProperty()
  playerCount!: number;

  @ApiProperty()
  updatedAt!: string;
}

export class RecentMatchListResponseDto {
  @ApiProperty({ type: [RecentMatchItemDto] })
  items!: RecentMatchItemDto[];
}

class ManualBalancePlayerDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty({ enum: Position })
  @IsEnum(Position)
  assignedRole!: Position;
}

class ManualBalanceTeamDto {
  @ApiProperty({ type: [ManualBalancePlayerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualBalancePlayerDto)
  players!: ManualBalancePlayerDto[];
}

export class SaveManualBalanceDto {
  @ApiProperty({ type: ManualBalanceTeamDto })
  @ValidateNested()
  @Type(() => ManualBalanceTeamDto)
  blueTeam!: ManualBalanceTeamDto;

  @ApiProperty({ type: ManualBalanceTeamDto })
  @ValidateNested()
  @Type(() => ManualBalanceTeamDto)
  redTeam!: ManualBalanceTeamDto;
}
