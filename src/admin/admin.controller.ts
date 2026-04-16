import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { AdminService } from './admin.service';
import {
  AdminAuditLogsQueryDto,
  AdminAuditLogsResponseDto,
  AdminDisputedResultsQueryDto,
  AdminDisputedResultsResponseDto,
  AdminRecruitingPostStatusResponseDto,
  AdminRecruitingPostsQueryDto,
  AdminRecruitingPostsResponseDto,
  AdminUserAdminFlagResponseDto,
  AdminUserDetailResponseDto,
  AdminUsersQueryDto,
  AdminUsersResponseDto,
  UpdateAdminFlagDto,
  UpdateRecruitingPostStatusDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List users for admin management.' })
  @ApiOkResponse({ type: AdminUsersResponseDto })
  listUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminUsersQueryDto,
  ): Promise<AdminUsersResponseDto> {
    return this.adminService.listUsers(user.userId, query);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Get a detailed user view for admins.' })
  @ApiOkResponse({ type: AdminUserDetailResponseDto })
  getUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<AdminUserDetailResponseDto> {
    return this.adminService.getUserDetail(user.userId, userId);
  }

  @Patch('users/:userId/admin')
  @ApiOperation({ summary: 'Grant or revoke admin privilege for a user.' })
  @ApiOkResponse({ type: AdminUserAdminFlagResponseDto })
  updateAdminFlag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateAdminFlagDto,
  ): Promise<AdminUserAdminFlagResponseDto> {
    return this.adminService.updateAdminFlag(user.userId, userId, dto);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'List audit logs with admin filters.' })
  @ApiOkResponse({ type: AdminAuditLogsResponseDto })
  listAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminAuditLogsQueryDto,
  ): Promise<AdminAuditLogsResponseDto> {
    return this.adminService.listAuditLogs(user.userId, query);
  }

  @Get('disputed-results')
  @ApiOperation({ summary: 'List disputed results for admin review.' })
  @ApiOkResponse({ type: AdminDisputedResultsResponseDto })
  listDisputedResults(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminDisputedResultsQueryDto,
  ): Promise<AdminDisputedResultsResponseDto> {
    return this.adminService.listDisputedResults(user.userId, query);
  }

  @Get('recruiting-posts')
  @ApiOperation({ summary: 'List recruiting posts for admin operations.' })
  @ApiOkResponse({ type: AdminRecruitingPostsResponseDto })
  listRecruitingPosts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminRecruitingPostsQueryDto,
  ): Promise<AdminRecruitingPostsResponseDto> {
    return this.adminService.listRecruitingPosts(user.userId, query);
  }

  @Patch('recruiting-posts/:postId/status')
  @ApiOperation({ summary: 'Update recruiting post status as admin.' })
  @ApiOkResponse({ type: AdminRecruitingPostStatusResponseDto })
  updateRecruitingPostStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('postId') postId: string,
    @Body() dto: UpdateRecruitingPostStatusDto,
  ): Promise<AdminRecruitingPostStatusResponseDto> {
    return this.adminService.updateRecruitingPostStatus(user.userId, postId, dto);
  }
}
