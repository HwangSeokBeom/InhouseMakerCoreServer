import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole, MatchStatus, Position, ResultStatus, TeamSide, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import {
  TopChampionAggregationStatusDto,
  TopChampionSummaryDto,
} from '../../riot/dto/top-champion.dto';

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ enum: Position })
  @IsOptional()
  @IsEnum(Position)
  primaryPosition?: Position;

  @ApiPropertyOptional({ enum: Position })
  @IsOptional()
  @IsEnum(Position)
  secondaryPosition?: Position;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFillAvailable?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  styleTags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  nickname?: string;
}

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty()
  isFillAvailable!: boolean;

  @ApiProperty({ type: [String] })
  styleTags!: string[];

  @ApiProperty()
  mannerScore!: number;

  @ApiProperty()
  noshowCount!: number;
}

export class UserProfileResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  mainPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty()
  isFillAvailable!: boolean;

  @ApiProperty({ nullable: true, required: false })
  recentPower!: number | null;

  @ApiProperty()
  profileVisible!: boolean;

  @ApiPropertyOptional()
  isBlockedByMe?: boolean;

  @ApiPropertyOptional()
  isBlockedUser?: boolean;

  @ApiPropertyOptional()
  canInteract?: boolean;

  @ApiProperty({ type: [String] })
  styleTags!: string[];

  @ApiProperty()
  mannerScore!: number;

  @ApiProperty()
  noshowCount!: number;

  @ApiProperty({ type: [TopChampionSummaryDto] })
  topChampions!: TopChampionSummaryDto[];

  @ApiProperty({ type: TopChampionAggregationStatusDto })
  topChampionAggregationStatus!: TopChampionAggregationStatusDto;
}

export class InviteUserSearchQueryDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  query!: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Optional group scope to annotate or exclude existing members.',
  })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'When groupId is provided, exclude users who already belong to the group.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }

    return value;
  })
  @IsBoolean()
  excludeExistingMembers?: boolean = false;
}

export class InviteUserSearchItemDto {
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

  @ApiPropertyOptional({ nullable: true })
  riotDisplayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  riotGameName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  tagLine!: string | null;

  @ApiPropertyOptional({ nullable: true })
  region!: string | null;

  @ApiPropertyOptional({ nullable: true })
  profileIconId!: number | null;

  @ApiPropertyOptional({ nullable: true })
  summonerLevel!: number | null;

  @ApiPropertyOptional({ nullable: true })
  profileImageUrl!: string | null;

  @ApiProperty()
  isSelf!: boolean;

  @ApiPropertyOptional()
  alreadyMember!: boolean | null;

  @ApiProperty()
  isAlreadyMember!: boolean;

  @ApiProperty()
  isEligible!: boolean;

  @ApiPropertyOptional({ nullable: true })
  inviteBlockedReason!: string | null;

  @ApiPropertyOptional({ enum: GroupRole, nullable: true })
  memberRole!: GroupRole | null;
}

export class InviteUserSearchResponseDto {
  @ApiProperty({ type: [InviteUserSearchItemDto] })
  items!: InviteUserSearchItemDto[];
}

export class InhouseHistoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}

class InhouseHistoryItemDto {
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

  @ApiProperty()
  scheduledAt!: string;

  @ApiProperty({ enum: Position })
  role!: Position;

  @ApiProperty()
  teamSide!: string;

  @ApiProperty()
  result!: string;

  @ApiProperty()
  kda!: string;

  @ApiProperty()
  deltaMmr!: number;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional({ nullable: true })
  resultStatus!: ResultStatus | null;
}

export class InhouseHistoryResponseDto {
  @ApiProperty({ type: [InhouseHistoryItemDto] })
  items!: InhouseHistoryItemDto[];
}

export class UserStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;
}

class UserMainPositionDto {
  @ApiProperty({ enum: Position })
  position!: Position;

  @ApiProperty()
  games!: number;
}

class PowerTrendSummaryDto {
  @ApiProperty({ enum: ['UP', 'DOWN', 'STABLE'] })
  direction!: 'UP' | 'DOWN' | 'STABLE';

  @ApiProperty()
  delta!: number;
}

export class UserStatsResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  totalGames!: number;

  @ApiProperty()
  wins!: number;

  @ApiProperty()
  losses!: number;

  @ApiProperty()
  winRate!: number;

  @ApiProperty({ type: [String] })
  recentForm!: string[];

  @ApiProperty({ type: [UserMainPositionDto] })
  mainPositions!: UserMainPositionDto[];

  @ApiProperty({ type: PowerTrendSummaryDto })
  powerTrendSummary!: PowerTrendSummaryDto;

  @ApiProperty()
  currentPower!: number;

  @ApiPropertyOptional()
  groupRank!: number | null;
}

export class DeleteMyAccountResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty()
  withdrawnAt!: string;
}
