import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole, GroupVisibility, JoinPolicy, MatchStatus, Position, ResultStatus, TeamSide } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsEmpty,
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
  @MaxLength(30)
  region?: string;

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

export class UpdateGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  region?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ enum: GroupVisibility })
  @IsOptional()
  @IsEnum(GroupVisibility)
  visibility?: GroupVisibility;

  @ApiPropertyOptional({ enum: JoinPolicy })
  @IsOptional()
  @IsEnum(JoinPolicy)
  joinPolicy?: JoinPolicy;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'ownerUserId cannot be changed via the group update endpoint.',
  })
  @IsOptional()
  @IsEmpty({ message: 'ownerUserId cannot be changed.' })
  ownerUserId?: string;
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
  groupId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  region!: string | null;

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

  @ApiPropertyOptional({ enum: ResultStatus })
  resultStatus!: ResultStatus | null;

  @ApiProperty()
  playerCount!: number;

  @ApiProperty()
  updatedAt!: string;
}

export class GroupRecentMatchesResponseDto {
  @ApiProperty({ type: [GroupRecentMatchItemDto] })
  items!: GroupRecentMatchItemDto[];
}

export class DeleteGroupResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  archivedAt!: string;
}
