import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole, GroupVisibility, JoinPolicy } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

