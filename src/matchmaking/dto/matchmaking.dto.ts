import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BalanceMode, Position, TeamSide } from '@prisma/client';
import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AutoBalanceDto {
  @ApiPropertyOptional({ enum: BalanceMode, default: BalanceMode.BALANCED })
  @IsOptional()
  @IsEnum(BalanceMode)
  mode?: BalanceMode;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lockedPlayerIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludePreviousCombinationKeys?: string[];
}

export class RerollDto extends AutoBalanceDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCandidateIds?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  excludePreviousCombination?: boolean = true;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regenerateNonce?: string;
}

export class SelectCandidateDto {
  @ApiProperty()
  @IsNumber()
  candidateNo!: number;
}

class CandidatePlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty({ enum: Position })
  assignedRole!: Position;

  @ApiProperty()
  rolePower!: number;
}

class CandidateMetricsDto {
  @ApiProperty()
  teamPowerGap!: number;

  @ApiProperty()
  laneMatchupGap!: number;

  @ApiProperty()
  offRolePenalty!: number;

  @ApiProperty()
  repeatTeamPenalty!: number;

  @ApiProperty()
  preferenceViolationPenalty!: number;

  @ApiProperty()
  volatilityClusterPenalty!: number;
}

class RepeatTeamPairDto {
  @ApiProperty({ type: [String] })
  userIds!: [string, string];

  @ApiProperty()
  sameTeamMatches!: number;

  @ApiProperty()
  weightedSameTeamScore!: number;

  @ApiProperty()
  penalty!: number;

  @ApiProperty({ type: [String] })
  recentMatchIds!: string[];
}

class RepeatTeamExplanationDto {
  @ApiProperty()
  matchesAnalyzed!: number;

  @ApiProperty()
  recentWindowSize!: number;

  @ApiProperty()
  repeatedDuoCount!: number;

  @ApiProperty({ type: [RepeatTeamPairDto] })
  penalizedPairs!: RepeatTeamPairDto[];
}

class CandidateExplanationDetailsDto {
  @ApiProperty({ type: RepeatTeamExplanationDto })
  repeatTeam!: RepeatTeamExplanationDto;
}

export class MatchmakingCandidateDto {
  @ApiProperty()
  candidateId!: string;

  @ApiProperty()
  combinationKey!: string;

  @ApiProperty()
  candidateNo!: number;

  @ApiProperty({ enum: BalanceMode })
  type!: BalanceMode;

  @ApiProperty()
  score!: number;

  @ApiProperty({ type: CandidateMetricsDto })
  metrics!: CandidateMetricsDto;

  @ApiProperty({ type: CandidateExplanationDetailsDto })
  explanationDetails!: CandidateExplanationDetailsDto;

  @ApiProperty()
  teamAPower!: number;

  @ApiProperty()
  teamBPower!: number;

  @ApiProperty()
  offRoleCount!: number;

  @ApiProperty({ type: [String] })
  explanationTags!: string[];

  @ApiProperty({ type: [CandidatePlayerDto] })
  teamA!: CandidatePlayerDto[];

  @ApiProperty({ type: [CandidatePlayerDto] })
  teamB!: CandidatePlayerDto[];
}

export class MatchmakingCandidatesResponseDto {
  @ApiProperty({ type: [MatchmakingCandidateDto] })
  candidates!: MatchmakingCandidateDto[];

  @ApiPropertyOptional({ type: Object })
  meta?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  debug?: Record<string, unknown>;
}

export class BalancePreviewPlayerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  userId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nickname!: string;

  @ApiPropertyOptional({ enum: Position, nullable: true })
  @IsOptional()
  @IsEnum(Position)
  primaryPosition?: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true })
  @IsOptional()
  @IsEnum(Position)
  secondaryPosition?: Position | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isFillAvailable?: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  overallPower!: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  lanePower?: Record<string, number>;

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

  @ApiPropertyOptional({ enum: TeamSide, nullable: true })
  @IsOptional()
  @IsEnum(TeamSide)
  lockedTeamSide?: TeamSide | null;

  @ApiPropertyOptional({ enum: Position, nullable: true })
  @IsOptional()
  @IsEnum(Position)
  lockedRole?: Position | null;
}

export class BalancePreviewDto {
  @ApiProperty({ type: [BalancePreviewPlayerDto] })
  @IsArray()
  @ArrayMinSize(10)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BalancePreviewPlayerDto)
  players!: BalancePreviewPlayerDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCandidateIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludePreviousCombinationKeys?: string[];
}
