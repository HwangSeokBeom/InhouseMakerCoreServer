import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PublicThrottle } from '../common/decorators/public-throttle.decorator';
import { PublicThrottleGuard } from '../common/guards/public-throttle.guard';
import { PublicGroupListResponseDto, PublicGroupsQueryDto } from './dto/groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@Controller('groups')
export class PublicGroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('public')
  @UseGuards(PublicThrottleGuard)
  @PublicThrottle({ scope: 'groups-public-list', limit: 60, windowSeconds: 60 })
  @ApiOperation({ summary: 'List publicly visible inhouse groups for guest discovery.' })
  @ApiOkResponse({ type: PublicGroupListResponseDto })
  listPublicGroups(
    @Query() query: PublicGroupsQueryDto,
  ): Promise<PublicGroupListResponseDto> {
    return this.groupsService.listPublicGroups(query);
  }
}
