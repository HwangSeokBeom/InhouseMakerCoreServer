import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BalanceMode, Position, TeamSide } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class AutoBalanceDto {
  @ApiPropertyOptional({ enum: BalanceMode, default: BalanceMode.BALANCED })
  @IsOptional()
  @IsEnum(BalanceMode)
  mode?: BalanceMode;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lockedPlayerIds?: string[];
}

export class RerollDto extends AutoBalanceDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeCandidateIds?: string[];
}

export class SelectCandidateDto {
  @ApiProperty()
  @IsNumber()
  candidateNo!: number;
}

class CandidatePlayerDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ enum: TeamSide })
  teamSide!: TeamSide;

  @ApiProperty({ enum: Position })
  assignedRole!: Position;

  @ApiProperty()
  rolePower!: number;
}

class CandidateMetricsDto {
  @ApiProperty()
  teamPowerGap!: number;

  @ApiProperty()
  laneMatchupGap!: number;

  @ApiProperty()
  offRolePenalty!: number;

  @ApiProperty()
  repeatTeamPenalty!: number;

  @ApiProperty()
  preferenceViolationPenalty!: number;

  @ApiProperty()
  volatilityClusterPenalty!: number;
}

export class MatchmakingCandidateDto {
  @ApiProperty()
  candidateId!: string;

  @ApiProperty()
  candidateNo!: number;

  @ApiProperty({ enum: BalanceMode })
  type!: BalanceMode;

  @ApiProperty()
  score!: number;

  @ApiProperty({ type: CandidateMetricsDto })
  metrics!: CandidateMetricsDto;

  @ApiProperty()
  teamAPower!: number;

  @ApiProperty()
  teamBPower!: number;

  @ApiProperty()
  offRoleCount!: number;

  @ApiProperty({ type: [String] })
  explanationTags!: string[];

  @ApiProperty({ type: [CandidatePlayerDto] })
  teamA!: CandidatePlayerDto[];

  @ApiProperty({ type: [CandidatePlayerDto] })
  teamB!: CandidatePlayerDto[];
}

export class MatchmakingCandidatesResponseDto {
  @ApiProperty({ type: [MatchmakingCandidateDto] })
  candidates!: MatchmakingCandidateDto[];
}

