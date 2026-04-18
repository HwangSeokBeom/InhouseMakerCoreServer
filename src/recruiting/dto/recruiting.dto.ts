import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Position, RecruitingPostStatus, RecruitingPostType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmpty,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) =>
      typeof item === 'string'
        ? item.split(',').map((part) => part.trim())
        : [],
    )
    .filter((item) => item.length > 0);
}

function toBoolean(value: unknown): boolean | unknown {
  if (value === 'true' || value === true) {
    return true;
  }

  if (value === 'false' || value === false) {
    return false;
  }

  return value;
}

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
  @IsEnum(Position, { each: true })
  requiredPositions?: string[];
}

export class UpdateRecruitingPostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @ApiPropertyOptional({ enum: Position, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Position, { each: true })
  requiredPositions?: Position[];

  @ApiPropertyOptional({ enum: RecruitingPostStatus })
  @IsOptional()
  @IsEnum(RecruitingPostStatus)
  status?: RecruitingPostStatus;

  @ApiPropertyOptional({
    enum: RecruitingPostType,
    description: 'postType cannot be changed after creation.',
  })
  @IsOptional()
  @IsEmpty({ message: 'postType cannot be changed.' })
  postType?: RecruitingPostType;

  @ApiPropertyOptional({
    description: 'groupId cannot be changed after creation.',
  })
  @IsOptional()
  @IsEmpty({ message: 'groupId cannot be changed.' })
  groupId?: string;
}

export class ApplyRecruitingPostDto {
  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  @IsOptional()
  @IsEnum(Position)
  position?: Position | null;

  @ApiPropertyOptional({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string | null;
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

  @ApiPropertyOptional({
    description: 'Filter posts scheduled on or after this ISO timestamp.',
  })
  @IsOptional()
  @IsDateString()
  scheduledFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter posts scheduled on or before this ISO timestamp.',
  })
  @IsOptional()
  @IsDateString()
  scheduledTo?: string;

  @ApiPropertyOptional({
    description:
      'When true and a scheduled range is provided, also include posts whose scheduledAt is null. Without a scheduled range, this flag does not change the default result set.',
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeUnscheduled?: boolean;

  @ApiPropertyOptional({
    enum: Position,
    isArray: true,
    description: 'Repeat the query param or send a comma-separated value.',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsEnum(Position, { each: true })
  requiredPositions?: Position[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Repeat the query param or send a comma-separated value.',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  region?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Repeat the query param or send a comma-separated value.',
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class PublicRecruitingQueryDto extends RecruitingQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

class RecruitingPostDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  postId!: string;

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

  @ApiProperty({ nullable: true, required: false })
  capacity!: number | null;

  @ApiProperty({ nullable: true, required: false })
  remainingSlots!: number | null;

  @ApiProperty()
  applicantCount!: number;
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

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty()
  isApplied!: boolean;

  @ApiProperty()
  canApply!: boolean;

  @ApiPropertyOptional({ type: Object, nullable: true })
  myApplication!: RecruitingApplicationDto | null;
}

class RecruitingApplicantDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty()
  appliedAt!: string;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  position!: Position | null;

  @ApiPropertyOptional({ nullable: true, required: false })
  memo!: string | null;
}

class RecruitingApplicationDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  appliedAt!: string;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  position!: Position | null;

  @ApiPropertyOptional({ nullable: true, required: false })
  memo!: string | null;
}

export class RecruitingApplicantListResponseDto {
  @ApiProperty({ type: [RecruitingApplicantDto] })
  items!: RecruitingApplicantDto[];
}

export class DeleteRecruitingPostResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  deletedAt!: string;
}
