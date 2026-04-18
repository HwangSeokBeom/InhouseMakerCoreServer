import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  AddGroupMemberDto,
  CreateGroupDto,
  DeleteGroupResponseDto,
  GroupDetailResponseDto,
  GroupLeaderboardQueryDto,
  GroupLeaderboardResponseDto,
  GroupMemberListResponseDto,
  GroupRecentMatchesResponseDto,
  RecentGroupMatchesQueryDto,
  UpdateGroupDto,
} from './dto/groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an inhouse group.' })
  @ApiCreatedResponse({ type: GroupDetailResponseDto })
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupDto,
  ): Promise<GroupDetailResponseDto> {
    return this.groupsService.createGroup(user.userId, dto);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Get group details.' })
  @ApiOkResponse({ type: GroupDetailResponseDto })
  getGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ): Promise<GroupDetailResponseDto> {
    return this.groupsService.getGroup(user.userId, groupId);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Update an inhouse group.' })
  @ApiOkResponse({ type: GroupDetailResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Only the group owner or admin can update this group.' })
  @ApiNotFoundResponse({ description: 'Group was not found.' })
  @ApiBadRequestResponse({ description: 'Payload is invalid.' })
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<GroupDetailResponseDto> {
    return this.groupsService.updateGroup(user.userId, groupId, dto);
  }

  @Delete(':groupId')
  @ApiOperation({ summary: 'Archive an inhouse group.' })
  @ApiOkResponse({ type: DeleteGroupResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'Only the group owner or admin can delete this group.' })
  @ApiNotFoundResponse({ description: 'Group was not found.' })
  deleteGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ): Promise<DeleteGroupResponseDto> {
    return this.groupsService.deleteGroup(user.userId, groupId);
  }

  @Post(':groupId/members')
  @ApiOperation({ summary: 'Add a member to a group.' })
  @ApiOkResponse({ type: GroupMemberListResponseDto })
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Body() dto: AddGroupMemberDto,
  ): Promise<GroupMemberListResponseDto> {
    return this.groupsService.addMember(user.userId, groupId, dto);
  }

  @Get(':groupId/members')
  @ApiOperation({ summary: 'List group members.' })
  @ApiOkResponse({ type: GroupMemberListResponseDto })
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
  ): Promise<GroupMemberListResponseDto> {
    return this.groupsService.listMembers(user.userId, groupId);
  }

  @Get(':groupId/leaderboard')
  @ApiOperation({ summary: 'Get group leaderboard summary.' })
  @ApiOkResponse({ type: GroupLeaderboardResponseDto })
  getLeaderboard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Query() query: GroupLeaderboardQueryDto,
  ): Promise<GroupLeaderboardResponseDto> {
    return this.groupsService.getLeaderboard(user.userId, groupId, query);
  }

  @Get(':groupId/matches/recent')
  @ApiOperation({ summary: 'Get recent matches for a group.' })
  @ApiOkResponse({ type: GroupRecentMatchesResponseDto })
  getRecentMatches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId') groupId: string,
    @Query() query: RecentGroupMatchesQueryDto,
  ): Promise<GroupRecentMatchesResponseDto> {
    return this.groupsService.getRecentMatches(user.userId, groupId, query);
  }
}
