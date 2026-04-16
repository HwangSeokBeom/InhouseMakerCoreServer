import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole, GroupVisibility, JoinPolicy, MatchStatus, Position, ResultStatus, TeamSide } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ enum: GroupVisibility, default: GroupVisibility.PRIVATE })
  @IsOptional()
  @IsEnum(GroupVisibility)
  visibility?: GroupVisibility;

  @ApiPropertyOptional({ enum: JoinPolicy, default: JoinPolicy.INVITE_ONLY })
  @IsOptional()
  @IsEnum(JoinPolicy)
  joinPolicy?: JoinPolicy;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AddGroupMemberDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiPropertyOptional({ enum: GroupRole, default: GroupRole.MEMBER })
  @IsOptional()
  @IsEnum(GroupRole)
  role?: GroupRole;
}

class GroupMemberDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: GroupRole })
  role!: GroupRole;
}

export class GroupMemberListResponseDto {
  @ApiProperty({ type: [GroupMemberDto] })
  items!: GroupMemberDto[];
}

export class GroupDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description!: string | null;

  @ApiProperty({ enum: GroupVisibility })
  visibility!: GroupVisibility;

  @ApiProperty({ enum: JoinPolicy })
  joinPolicy!: JoinPolicy;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  memberCount!: number;

  @ApiProperty()
  recentMatches!: number;
}

export class PublicGroupsQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class PublicGroupListResponseDto {
  @ApiProperty({ type: [GroupDetailResponseDto] })
  items!: GroupDetailResponseDto[];
}

export class GroupLeaderboardQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

class GroupLeaderboardItemDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty()
  currentPower!: number;

  @ApiProperty()
  totalGames!: number;

  @ApiProperty()
  wins!: number;

  @ApiProperty()
  losses!: number;

  @ApiProperty()
  winRate!: number;

  @ApiProperty()
  groupRank!: number;
}

export class GroupLeaderboardResponseDto {
  @ApiProperty({ type: [GroupLeaderboardItemDto] })
  items!: GroupLeaderboardItemDto[];
}

export class RecentGroupMatchesQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

class GroupRecentMatchItemDto {
  @ApiProperty()
  matchId!: string;

  @ApiPropertyOptional()
  title!: string | null;

  @ApiProperty({ enum: MatchStatus })
  status!: MatchStatus;

  @ApiPropertyOptional()
  scheduledAt!: string | null;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional({ enum: ResultStatus })
  resultStatus!: ResultStatus | null;

  @ApiProperty()
  playerCount!: number;
}

export class GroupRecentMatchesResponseDto {
  @ApiProperty({ type: [GroupRecentMatchItemDto] })
  items!: GroupRecentMatchItemDto[];
}
