import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ConfirmationAction,
  InputMode,
  LaneResult,
  ResultStatus,
  TeamSide,
} from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuickResultPlayerDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  kills!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  deaths!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  assists!: number;

  @ApiProperty({ enum: LaneResult })
  @IsEnum(LaneResult)
  laneResult!: LaneResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  contributionRating?: number;
}

export class QuickResultDto {
  @ApiProperty({ enum: TeamSide })
  @IsEnum(TeamSide)
  winningTeam!: TeamSide;

  @ApiProperty()
  @IsString()
  mvpUserId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceRating!: number;

  @ApiProperty({ type: [QuickResultPlayerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickResultPlayerDto)
  players!: QuickResultPlayerDto[];
}

export class ConfirmResultDto {
  @ApiProperty({ enum: ConfirmationAction })
  @IsEnum(ConfirmationAction)
  action!: ConfirmationAction;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  diff?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ResultSubmissionResponseDto {
  @ApiProperty()
  resultId!: string;

  @ApiProperty({ enum: ResultStatus })
  status!: ResultStatus;

  @ApiProperty()
  confirmationNeeded!: number;
}

class ResultConfirmationDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: ConfirmationAction })
  action!: ConfirmationAction;

  @ApiPropertyOptional({ type: Object })
  diff!: Record<string, unknown> | null;

  @ApiPropertyOptional()
  comment!: string | null;

  @ApiProperty()
  createdAt!: string;
}

class ResultStatDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  kills!: number;

  @ApiProperty()
  deaths!: number;

  @ApiProperty()
  assists!: number;

  @ApiProperty({ enum: LaneResult })
  laneResult!: LaneResult;
}

export class MatchResultResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiProperty({ enum: ResultStatus })
  resultStatus!: ResultStatus;

  @ApiProperty({ enum: InputMode })
  inputMode!: InputMode;

  @ApiProperty({ type: [ResultStatDto] })
  players!: ResultStatDto[];

  @ApiProperty({ type: [ResultConfirmationDto] })
  confirmations!: ResultConfirmationDto[];
}

