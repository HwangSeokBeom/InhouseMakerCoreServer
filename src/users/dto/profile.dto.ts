import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Position, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  @ApiPropertyOptional({ enum: Position })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position })
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
  matchId!: string;

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
