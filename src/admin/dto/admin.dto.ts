import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GroupRole,
  Position,
  RecruitingPostStatus,
  RiotSyncStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

class PaginationDto {
  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  hasMore!: boolean;

  @ApiPropertyOptional()
  nextOffset!: number | null;
}

export class AdminUsersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) {
      return true;
    }
    if (value === 'false' || value === false) {
      return false;
    }
    return value;
  })
  @IsBoolean()
  isAdmin?: boolean;

  @ApiPropertyOptional({ enum: ['createdAt', 'nickname', 'email'], default: 'createdAt' })
  @IsOptional()
  @IsEnum(['createdAt', 'nickname', 'email'])
  sortBy?: 'createdAt' | 'nickname' | 'email' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

class AdminUserListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty()
  isAdmin!: boolean;

  @ApiPropertyOptional({ enum: Position })
  primaryPosition!: Position | null;

  @ApiProperty()
  currentPower!: number;

  @ApiProperty()
  groupCount!: number;

  @ApiProperty()
  riotAccountCount!: number;

  @ApiProperty()
  createdAt!: string;
}

export class AdminUsersResponseDto {
  @ApiProperty({ type: [AdminUserListItemDto] })
  items!: AdminUserListItemDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

class AdminUserGroupMembershipDto {
  @ApiProperty()
  groupId!: string;

  @ApiProperty()
  groupName!: string;

  @ApiProperty({ enum: GroupRole })
  role!: GroupRole;
}

class AdminUserRiotAccountDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  riotId!: string;

  @ApiProperty({ enum: RiotSyncStatus })
  syncStatus!: RiotSyncStatus;

  @ApiPropertyOptional()
  lastSyncSucceededAt!: string | null;
}

class AdminUserPowerProfileDto {
  @ApiProperty()
  currentPower!: number;

  @ApiProperty()
  inhouseMmr!: number;

  @ApiProperty()
  confidence!: number;
}

export class AdminUserDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty()
  isAdmin!: boolean;

  @ApiPropertyOptional({ enum: Position })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position })
  secondaryPosition!: Position | null;

  @ApiProperty()
  isFillAvailable!: boolean;

  @ApiProperty()
  mannerScore!: number;

  @ApiProperty()
  noshowCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [AdminUserGroupMembershipDto] })
  groupMemberships!: AdminUserGroupMembershipDto[];

  @ApiProperty({ type: [AdminUserRiotAccountDto] })
  riotAccounts!: AdminUserRiotAccountDto[];

  @ApiPropertyOptional({ type: AdminUserPowerProfileDto })
  powerProfile!: AdminUserPowerProfileDto | null;
}

export class UpdateAdminFlagDto {
  @ApiProperty()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isAdmin!: boolean;
}

export class AdminUserAdminFlagResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  isAdmin!: boolean;
}

export class AdminAuditLogsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

class AdminAuditLogItemDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  actorUserId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  entityId!: string;

  @ApiPropertyOptional({ type: Object })
  meta!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;
}

export class AdminAuditLogsResponseDto {
  @ApiProperty({ type: [AdminAuditLogItemDto] })
  items!: AdminAuditLogItemDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class AdminDisputedResultsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

class AdminDisputedResultItemDto {
  @ApiProperty()
  resultId!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty()
  groupId!: string;

  @ApiPropertyOptional()
  matchTitle!: string | null;

  @ApiProperty()
  submittedBy!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}

export class AdminDisputedResultsResponseDto {
  @ApiProperty({ type: [AdminDisputedResultItemDto] })
  items!: AdminDisputedResultItemDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class AdminRecruitingPostsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ enum: RecruitingPostStatus })
  @IsOptional()
  @IsEnum(RecruitingPostStatus)
  status?: RecruitingPostStatus;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

class AdminRecruitingPostItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  groupId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: RecruitingPostStatus })
  status!: RecruitingPostStatus;

  @ApiProperty()
  applicantCount!: number;

  @ApiProperty()
  createdAt!: string;
}

export class AdminRecruitingPostsResponseDto {
  @ApiProperty({ type: [AdminRecruitingPostItemDto] })
  items!: AdminRecruitingPostItemDto[];

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class UpdateRecruitingPostStatusDto {
  @ApiProperty({ enum: RecruitingPostStatus })
  @IsEnum(RecruitingPostStatus)
  status!: RecruitingPostStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminRecruitingPostStatusResponseDto {
  @ApiProperty()
  postId!: string;

  @ApiProperty({ enum: RecruitingPostStatus })
  status!: RecruitingPostStatus;
}
