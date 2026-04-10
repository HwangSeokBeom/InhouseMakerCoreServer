import { ApiProperty } from '@nestjs/swagger';

class StyleScoresDto {
  @ApiProperty()
  stability!: number;

  @ApiProperty()
  carry!: number;

  @ApiProperty()
  teamContribution!: number;

  @ApiProperty()
  laneInfluence!: number;
}

export class PowerProfileResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  overallPower!: number;

  @ApiProperty({ type: Object })
  lanePower!: Record<string, number>;

  @ApiProperty({ type: StyleScoresDto })
  style!: StyleScoresDto;

  @ApiProperty()
  basePower!: number;

  @ApiProperty()
  formScore!: number;

  @ApiProperty()
  inhouseMmr!: number;

  @ApiProperty()
  inhouseConfidence!: number;

  @ApiProperty()
  version!: string;

  @ApiProperty()
  calculatedAt!: string;
}

