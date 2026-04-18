import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ConfirmationAction,
  InputMode,
  LaneResult,
  Position,
  ResultStatus,
  TeamSide,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  MinLength,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceRating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceFeeling?: number;

  @ApiProperty({ type: [QuickResultPlayerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickResultPlayerDto)
  players!: QuickResultPlayerDto[];
}

export class QuickResultPreviewPlayerDto extends QuickResultPlayerDto {
  @ApiProperty({ enum: TeamSide })
  @IsEnum(TeamSide)
  teamSide!: TeamSide;
}

export class QuickResultPreviewDto {
  @ApiProperty({ enum: TeamSide })
  @IsEnum(TeamSide)
  winningTeam!: TeamSide;

  @ApiProperty()
  @IsString()
  mvpUserId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceRating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceFeeling?: number;

  @ApiProperty({ type: [QuickResultPreviewPlayerDto] })
  @IsArray()
  @ArrayMinSize(10)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuickResultPreviewPlayerDto)
  players!: QuickResultPreviewPlayerDto[];
}

class QuickResultPreviewTeamSummaryDto {
  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty()
  playerCount!: number;

  @ApiProperty()
  kills!: number;

  @ApiProperty()
  deaths!: number;

  @ApiProperty()
  assists!: number;
}

export class QuickResultPreviewResponseDto {
  @ApiProperty()
  validated!: true;

  @ApiProperty()
  playerCount!: number;

  @ApiProperty()
  mvpUserId!: string;

  @ApiProperty({ enum: TeamSide })
  winningTeam!: TeamSide;

  @ApiProperty()
  balanceRating!: number;

  @ApiProperty({ type: [QuickResultPreviewTeamSummaryDto] })
  teams!: QuickResultPreviewTeamSummaryDto[];
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

export class AdminResolveResultDto {
  @ApiProperty({ enum: TeamSide })
  @IsEnum(TeamSide)
  winningTeam!: TeamSide;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mvpUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  balanceRating?: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}

export class ResultSubmissionResponseDto {
  @ApiProperty()
  resultId!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty({ enum: ResultStatus })
  status!: ResultStatus;

  @ApiProperty()
  confirmationNeeded!: number;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  savedAt!: string;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiPropertyOptional()
  mvpUserId!: string | null;

  @ApiPropertyOptional()
  balanceRating!: number | null;

  @ApiPropertyOptional()
  balanceFeeling!: number | null;

  @ApiProperty()
  isFinalized!: boolean;
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

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  proposedWinningTeam!: TeamSide | null;

  @ApiProperty()
  createdAt!: string;
}

class ResultStatDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty({ enum: Position })
  role!: Position;

  @ApiProperty()
  kills!: number;

  @ApiProperty()
  deaths!: number;

  @ApiProperty()
  assists!: number;

  @ApiProperty({ enum: LaneResult })
  laneResult!: LaneResult;

  @ApiPropertyOptional({ nullable: true })
  contributionRating!: number | null;
}

export class MatchResultResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty({ enum: TeamSide, nullable: true, required: false })
  winningTeam!: TeamSide | null;

  @ApiProperty({ enum: ResultStatus })
  resultStatus!: ResultStatus;

  @ApiProperty({ enum: InputMode })
  inputMode!: InputMode;

  @ApiProperty()
  submittedBy!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional()
  balanceRating!: number | null;

  @ApiPropertyOptional()
  balanceFeeling!: number | null;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional()
  confirmedAt!: string | null;

  @ApiPropertyOptional()
  adminResolvedById!: string | null;

  @ApiPropertyOptional()
  adminResolutionNote!: string | null;

  @ApiPropertyOptional()
  adminResolvedAt!: string | null;

  @ApiProperty({ type: [ResultStatDto] })
  players!: ResultStatDto[];

  @ApiProperty({ type: [ResultConfirmationDto] })
  confirmations!: ResultConfirmationDto[];
}

class ResultDisputeSummaryDto {
  @ApiProperty()
  participantCount!: number;

  @ApiProperty()
  confirmCount!: number;

  @ApiProperty()
  conflictingCount!: number;

  @ApiProperty()
  winningTeamConflict!: boolean;
}

export class ResultDisputeResponseDto extends MatchResultResponseDto {
  @ApiProperty({ type: ResultDisputeSummaryDto })
  disputeSummary!: ResultDisputeSummaryDto;
}

export class AdminResolveResultResponseDto {
  @ApiProperty()
  resultId!: string;

  @ApiProperty({ enum: ResultStatus })
  status!: ResultStatus;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional()
  adminResolvedAt!: string | null;
}
