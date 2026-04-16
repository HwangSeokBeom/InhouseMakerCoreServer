import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { PublicRecruitingQueryDto, RecruitingPostListResponseDto } from './dto/recruiting.dto';
import { RecruitingService } from './recruiting.service';

@ApiTags('recruiting-posts')
@Controller('recruiting-posts')
export class PublicRecruitingController {
  constructor(private readonly recruitingService: RecruitingService) {}

  @Get('public')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'recruiting-public-list', limit: 60, windowSeconds: 60 })
  @ApiOperation({ summary: 'List public recruiting posts for guest browsing.' })
  @ApiOkResponse({ type: RecruitingPostListResponseDto })
  listPublicPosts(
    @Query() query: PublicRecruitingQueryDto,
  ): Promise<RecruitingPostListResponseDto> {
    return this.recruitingService.listPublicPosts(query);
  }
}
