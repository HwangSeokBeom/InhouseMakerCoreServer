import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Position } from '@prisma/client';

import {
  TopChampionAggregationStatusDto,
  TopChampionSummaryDto,
} from '../../riot/dto/top-champion.dto';

export class PowerProfileStyleDto {
  @ApiProperty()
  stability!: number;

  @ApiProperty()
  carry!: number;

  @ApiProperty()
  teamContribution!: number;

  @ApiProperty()
  laneInfluence!: number;

  @ApiProperty({ enum: Position })
  roleFocus!: Position;

  @ApiPropertyOptional({ required: false })
  seeded?: boolean;
}

export class PowerProfileResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  overallPower!: number;

  @ApiProperty({ type: Object })
  lanePower!: Record<string, number>;

  @ApiProperty({ type: PowerProfileStyleDto })
  style!: PowerProfileStyleDto;

  @ApiProperty()
  basePower!: number;

  @ApiProperty()
  formScore!: number;

  @ApiProperty()
  inhouseMmr!: number;

  @ApiProperty()
  inhouseConfidence!: number;

  @ApiProperty()
  inhouseWeight!: number;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  primaryPosition!: Position | null;

  @ApiPropertyOptional({ enum: Position, nullable: true, required: false })
  secondaryPosition!: Position | null;

  @ApiProperty({ type: Object })
  explanation!: Record<string, unknown>;

  @ApiProperty()
  version!: string;

  @ApiProperty()
  calculatedAt!: string;

  @ApiProperty({ type: [TopChampionSummaryDto] })
  topChampions!: TopChampionSummaryDto[];

  @ApiProperty({ type: TopChampionAggregationStatusDto })
  topChampionAggregationStatus!: TopChampionAggregationStatusDto;
}
