import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Position } from '@prisma/client';

import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';

class ReferenceValuesResponseDto {
  @ApiProperty({ type: [String] })
  items!: string[];
}

const RIOT_TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;

@ApiTags('reference')
@Controller('reference')
export class ReferenceController {
  @Get('positions')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'reference-positions', limit: 120, windowSeconds: 60 })
  @ApiOperation({ summary: 'List supported LoL positions for guest and authenticated clients.' })
  @ApiOkResponse({ type: ReferenceValuesResponseDto })
  getPositions(): ReferenceValuesResponseDto {
    return {
      items: [
        Position.TOP,
        Position.JUNGLE,
        Position.MID,
        Position.ADC,
        Position.SUPPORT,
      ],
    };
  }

  @Get('tiers')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'reference-tiers', limit: 120, windowSeconds: 60 })
  @ApiOperation({ summary: 'List supported ranked tiers for reference surfaces.' })
  @ApiOkResponse({ type: ReferenceValuesResponseDto })
  getTiers(): ReferenceValuesResponseDto {
    return {
      items: [...RIOT_TIERS],
    };
  }
}
