import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecruitingPostStatus, RecruitingPostType } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRecruitingPostDto {
  @ApiProperty()
  @IsString()
  groupId!: string;

  @ApiProperty({ enum: RecruitingPostType })
  @IsEnum(RecruitingPostType)
  postType!: RecruitingPostType;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredPositions?: string[];
}

export class RecruitingQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ enum: RecruitingPostType })
  @IsOptional()
  @IsEnum(RecruitingPostType)
  postType?: RecruitingPostType;

  @ApiPropertyOptional({ enum: RecruitingPostStatus })
  @IsOptional()
  @IsEnum(RecruitingPostStatus)
  status?: RecruitingPostStatus;
}

class RecruitingPostDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  groupId!: string;

  @ApiProperty({ enum: RecruitingPostType })
  postType!: RecruitingPostType;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: RecruitingPostStatus })
  status!: RecruitingPostStatus;

  @ApiPropertyOptional()
  scheduledAt!: string | null;
}

export class RecruitingPostListResponseDto {
  @ApiProperty({ type: [RecruitingPostDto] })
  items!: RecruitingPostDto[];
}

export class RecruitingPostResponseDto extends RecruitingPostDto {
  @ApiPropertyOptional()
  body!: string | null;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty({ type: [String] })
  requiredPositions!: string[];

  @ApiProperty()
  createdBy!: string;
}

