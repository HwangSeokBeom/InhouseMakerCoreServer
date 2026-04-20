import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopChampionSummaryDto {
  @ApiPropertyOptional({ nullable: true, required: false })
  championId!: number | null;

  @ApiProperty()
  championKey!: string;

  @ApiProperty()
  championName!: string;

  @ApiProperty()
  games!: number;

  @ApiProperty()
  wins!: number;

  @ApiProperty()
  losses!: number;

  @ApiProperty({
    description: 'Normalized win rate between 0 and 1.',
  })
  winRate!: number;

  @ApiProperty()
  kills!: number;

  @ApiProperty()
  deaths!: number;

  @ApiProperty()
  assists!: number;

  @ApiPropertyOptional({ nullable: true, required: false })
  kda!: number | null;

  @ApiPropertyOptional({ nullable: true, required: false })
  lastPlayedAt!: string | null;
}

export class TopChampionAggregationStatusDto {
  @ApiProperty({
    enum: ['READY', 'PARTIAL', 'EMPTY'],
  })
  status!: 'READY' | 'PARTIAL' | 'EMPTY';

  @ApiPropertyOptional({
    enum: [
      'none',
      'no_riot_account',
      'no_sync',
      'insufficient_backfill',
      'insufficient_sample',
      'all_filtered',
      'mapping_failure',
    ],
    nullable: true,
    required: false,
  })
  reason!:
    | 'none'
    | 'no_riot_account'
    | 'no_sync'
    | 'insufficient_backfill'
    | 'insufficient_sample'
    | 'all_filtered'
    | 'mapping_failure'
    | null;

  @ApiProperty()
  message!: string;

  @ApiProperty({
    description: 'True when topChampions contains content that can be rendered.',
  })
  hasUsableContent!: boolean;

  @ApiProperty()
  totalMatches!: number;

  @ApiProperty()
  rankedMatches!: number;

  @ApiProperty()
  eligibleMatches!: number;

  @ApiProperty()
  mappedMatches!: number;

  @ApiPropertyOptional({ nullable: true, required: false })
  thresholdUsed!: number | null;

  @ApiProperty({ type: Object })
  syncCoverageSummary!: Record<string, unknown>;
}
