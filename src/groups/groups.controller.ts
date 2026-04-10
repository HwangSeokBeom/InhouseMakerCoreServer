import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import {
  AddGroupMemberDto,
  CreateGroupDto,
  GroupDetailResponseDto,
  GroupMemberListResponseDto,
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
}

